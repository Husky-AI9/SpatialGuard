"""Ring account ownership, durable signed inbox, camera mapping and bounded media."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import shutil
import smtplib
import time
from email.message import EmailMessage
from contextlib import contextmanager
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from urllib.parse import quote, urlparse
from fastapi import HTTPException
from .store import Store, DATA, account_preferences, digest, dump, uid, now, event, audit
from .ring_provider import Provider, ServerVault, WindowsVault, credentials


def hardware_model(attributes):
    """Presentation family from Ring's product artwork, never the user's device name.

    The official inventory currently supplies name/image_url, not a model field.
    Recognize explicit product filenames; keep unfamiliar hardware unknown.
    Do not fetch the image or expose provider URLs to clients.
    """
    url = attributes.get('image_url')
    if not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname != 'app-content.ring.com':
            return None
        name = parsed.path.rsplit('/', 1)[-1].lower().replace('-', '_')
    except ValueError:
        return None
    if name.startswith(('rvd_', 'video_doorbell_')):
        return 'video_doorbell'
    if name.startswith(('stick_up_cam_', 'stickup_cam_', 'stickupcam_')):
        return 'stick_up_cam'
    return None


def capability_summary(capabilities):
    """Reduce Ring capability data to customer-safe feature decisions.

    Unknown or absent capability data is intentionally treated as unsupported.
    This keeps media controls fail-closed for sensors and newly introduced
    device families until Ring explicitly reports camera support.
    """
    values = capabilities if isinstance(capabilities, dict) else {}
    video = values.get('video')
    motion = values.get('motion_detection')
    components = values.get('components', {}).get('items', [])
    is_camera = isinstance(video, dict)
    return {
        'live_view': is_camera,
        'snapshots': is_camera,
        'motion_events': isinstance(motion, dict),
        'multi_camera': isinstance(components, list) and len(components) > 1,
    }


def configuration_summary(configuration):
    """Return compliance state without retaining privacy-zone coordinates."""
    values = configuration if isinstance(configuration, dict) else {}
    motion = values.get('motion_detection')
    enhancements = values.get('image_enhancements')
    privacy_known = isinstance(enhancements, dict) and isinstance(
        enhancements.get('privacy_zones'), list
    )
    privacy_active = privacy_known and bool(enhancements['privacy_zones'])
    guidance = []
    if not isinstance(motion, dict):
        guidance.append('Motion settings are unavailable. Refresh this camera, then check Motion Settings in the Ring app.')
    elif motion.get('enabled') != 'on':
        guidance.append('Motion detection is off. Turn it on in the Ring app under this camera’s Motion Settings.')
    if not privacy_known:
        guidance.append('Privacy-zone status is unavailable. Refresh before opening or analyzing camera media.')
    elif privacy_active:
        guidance.append('Ring privacy zones are active. SpatialGuard blocks media for this camera so masked areas are never processed.')
    return {
        'motion_detection': ('on' if isinstance(motion, dict) and motion.get('enabled') == 'on'
                             else 'off' if isinstance(motion, dict) else 'unknown'),
        'privacy_zones': 'active' if privacy_active else 'clear' if privacy_known else 'unknown',
        'guidance': guidance,
    }


def subscription_summary(payload):
    """Normalize the app-scoped Ring subscription response without plan IDs."""
    records = payload.get('data', []) if isinstance(payload, dict) else []
    if not isinstance(records, list):
        records = []
    states = []
    for record in records:
        attributes = record.get('attributes', {}) if isinstance(record, dict) else {}
        status = attributes.get('status')
        kind = attributes.get('sub_type')
        if status in {'active', 'inactive'} and kind in {'paid', 'trial'}:
            states.append({
                'kind': kind,
                'status': status,
                'expires_at': attributes.get('expires_at') if isinstance(attributes.get('expires_at'), str) else None,
            })
    active = next((item for item in states if item['status'] == 'active'), None)
    required = os.environ.get('SPATIALGUARD_REQUIRE_RING_SUBSCRIPTION', '').lower() in {'1','true','yes','on'}
    return {
        'required': required,
        'eligible': bool(active) or not required,
        'state': ('active_' + active['kind']) if active else 'not_active',
        'expires_at': active['expires_at'] if active else None,
        'manage_url': 'https://ring.com/my-apps',
    }


@contextmanager
def account_lock(store, account):
    # Cross-process lock keeps rotating refresh tokens serial across API/gateway/worker.
    path = store.path.parent / ('ring-lock-' + digest(account))
    with path.open('a+b') as f:
        if f.tell() == 0:
            f.write(b'0'); f.flush()
        f.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise HTTPException(409, 'Ring request in progress. Retry shortly.') from None
        try:
            yield
        finally:
            f.seek(0)
            if os.name == 'nt':
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


class RingService:
    def __init__(self, store=None, provider=None, vault=None):
        self.store = store or Store()
        self._provider = provider
        self.vault = vault or (WindowsVault() if os.name == 'nt' else ServerVault())
        self._snapshots = {}
        with self.store.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS ring_accounts(account TEXT PRIMARY KEY, owner TEXT,
                tokens BLOB, state TEXT NOT NULL, expires REAL NOT NULL, generation INTEGER NOT NULL DEFAULT 0);
            CREATE UNIQUE INDEX IF NOT EXISTS ring_one_owner ON ring_accounts(owner) WHERE owner IS NOT NULL;
            CREATE TABLE IF NOT EXISTS ring_codes(digest TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS ring_nonces(digest TEXT PRIMARY KEY, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS ring_link_continuations(digest TEXT PRIMARY KEY, owner TEXT NOT NULL,
                nonce_digest TEXT NOT NULL, stamp TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS ring_grants(digest TEXT PRIMARY KEY, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS ring_devices(account TEXT NOT NULL, device TEXT NOT NULL, data TEXT NOT NULL,
                site TEXT, camera TEXT, PRIMARY KEY(account,device), UNIQUE(site,camera));
            CREATE TABLE IF NOT EXISTS ring_inbox(id TEXT PRIMARY KEY, account TEXT NOT NULL, device TEXT NOT NULL,
                kind TEXT NOT NULL, at TEXT NOT NULL, received TEXT NOT NULL, subtype TEXT NOT NULL,
                state TEXT NOT NULL, snapshot TEXT, attempts INTEGER NOT NULL DEFAULT 0, lease REAL NOT NULL DEFAULT 0,
                processed TEXT, error TEXT, provider_request TEXT);
            CREATE TABLE IF NOT EXISTS ring_streams(id TEXT PRIMARY KEY, account TEXT NOT NULL, device TEXT NOT NULL,
                owner TEXT NOT NULL, path TEXT, expires REAL NOT NULL, state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ring_health(account TEXT NOT NULL, device TEXT NOT NULL,
                at REAL NOT NULL, online INTEGER NOT NULL, source TEXT NOT NULL,
                PRIMARY KEY(account,device,at));
            CREATE TABLE IF NOT EXISTS ring_alerts(id TEXT PRIMARY KEY, owner TEXT NOT NULL,
                device TEXT NOT NULL, kind TEXT NOT NULL, at REAL NOT NULL, notify_at REAL NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0, emailed INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS ring_ops_preferences(owner TEXT PRIMARY KEY,
                delay_seconds INTEGER NOT NULL DEFAULT 0, browser_enabled INTEGER NOT NULL DEFAULT 0,
                email_enabled INTEGER NOT NULL DEFAULT 0, email TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS ring_camera_wall(owner TEXT PRIMARY KEY, devices TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ring_account_metadata(account TEXT PRIMARY KEY,
                subscription TEXT NOT NULL, checked_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ring_telemetry(account TEXT NOT NULL, name TEXT NOT NULL,
                count INTEGER NOT NULL, total REAL NOT NULL, maximum REAL NOT NULL,
                updated TEXT NOT NULL, PRIMARY KEY(account,name));
            CREATE TABLE IF NOT EXISTS timelapse_projects(id TEXT PRIMARY KEY, owner TEXT NOT NULL,
                device TEXT NOT NULL, site TEXT NOT NULL, camera TEXT NOT NULL, name TEXT NOT NULL,
                cadence_minutes INTEGER NOT NULL, start_hour INTEGER NOT NULL, end_hour INTEGER NOT NULL,
                timezone TEXT NOT NULL, enabled INTEGER NOT NULL, next_capture REAL NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS timelapse_frames(id TEXT PRIMARY KEY, project TEXT NOT NULL,
                at REAL NOT NULL, path TEXT NOT NULL, media_type TEXT NOT NULL);
            ''')
            columns = {row['name'] for row in db.execute('PRAGMA table_info(ring_inbox)')}
            if 'processed' not in columns:
                db.execute('ALTER TABLE ring_inbox ADD COLUMN processed TEXT')
            if 'error' not in columns:
                db.execute('ALTER TABLE ring_inbox ADD COLUMN error TEXT')
            if 'provider_request' not in columns:
                db.execute('ALTER TABLE ring_inbox ADD COLUMN provider_request TEXT')

    def _record_health(self, db, account, device, online, source, at=None):
        at = float(at or time.time())
        previous = db.execute(
            'SELECT online FROM ring_health WHERE account=? AND device=? ORDER BY at DESC LIMIT 1',
            (account, device),
        ).fetchone()
        value = 1 if online else 0
        if previous is not None and previous['online'] == value:
            return
        db.execute('INSERT OR IGNORE INTO ring_health VALUES (?,?,?,?,?)',
                   (account, device, at, value, source))
        owner_row = db.execute('SELECT owner FROM ring_accounts WHERE account=?', (account,)).fetchone()
        if not owner_row or not owner_row['owner'] or previous is None:
            return
        owner = owner_row['owner']
        preference = db.execute(
            'SELECT delay_seconds FROM ring_ops_preferences WHERE owner=?', (owner,)
        ).fetchone()
        delay = int(preference['delay_seconds']) if preference else 0
        if not online:
            db.execute('INSERT INTO ring_alerts VALUES (?,?,?,?,?,?,0,0)',
                       (uid('health'), owner, device, 'offline', at, at + delay))
        else:
            pending = db.execute(
                "SELECT id FROM ring_alerts WHERE owner=? AND device=? AND kind='offline' "
                'AND notify_at>? AND acknowledged=0', (owner, device, at)
            ).fetchall()
            if pending:
                db.executemany('DELETE FROM ring_alerts WHERE id=?', [(row['id'],) for row in pending])
            else:
                db.execute('INSERT INTO ring_alerts VALUES (?,?,?,?,?,?,0,0)',
                           (uid('health'), owner, device, 'recovered', at, at))

    def _metric(self, db, account, name, value=0.0, count=1):
        """Store bounded aggregate telemetry without provider IDs or payloads."""
        db.execute(
            'INSERT INTO ring_telemetry VALUES (?,?,?,?,?,?) '
            'ON CONFLICT(account,name) DO UPDATE SET count=count+excluded.count,'
            'total=total+excluded.total,maximum=max(maximum,excluded.maximum),updated=excluded.updated',
            (account, name, int(count), float(value), float(value), now()),
        )

    @property
    def provider(self):
        return self._provider or Provider()

    def status(self, owner):
        try:
            self.provider
            ready = getattr(self.vault, 'ready', None)
            if ready:
                ready()
            configured = True
        except HTTPException:
            configured = False
        with self.store.connect() as db:
            a = db.execute('SELECT account,state FROM ring_accounts WHERE owner=?', (owner,)).fetchone()
            public = db.execute("SELECT value FROM settings WHERE key='ring_public_url'").fetchone()
            metadata = (db.execute('SELECT subscription,checked_at FROM ring_account_metadata WHERE account=?',
                                   (a['account'],)).fetchone() if a else None)
            return {'configured': configured, 'state': a['state'] if a else 'not_connected',
                    'public_url': (os.environ.get('SPATIALGUARD_ORIGIN', '').rstrip('/')
                                   if os.environ.get('SPATIALGUARD_ORIGIN', '').startswith('https://')
                                   else public[0] if public else None),
                    'subscription': json.loads(metadata['subscription']) if metadata else None,
                    'subscription_checked_at': metadata['checked_at'] if metadata else None}

    def code(self, owner):
        code = secrets.token_hex(8).upper()
        with self.store.connect() as db:
            db.execute('DELETE FROM ring_codes WHERE owner=? OR expires<?', (owner, time.time()))
            db.execute('INSERT INTO ring_codes VALUES (?,?,?)', (digest(code), owner, time.time()+600))
        return {'code': code, 'expires_at': time.time()+600}

    def continuation(self, owner, nonce, stamp):
        """Create a one-use, owner-session-bound Ring linking continuation."""
        self._validate_link_request(nonce, stamp)
        token = secrets.token_urlsafe(32)
        with self.store.connect() as db:
            db.execute('DELETE FROM ring_link_continuations WHERE owner=? OR expires<?', (owner, time.time()))
            db.execute('INSERT INTO ring_link_continuations VALUES (?,?,?,?,?)',
                       (digest(token), owner, digest(nonce), stamp, time.time()+600))
        return token

    def throttle(self, key, limit=20):
        blocked = False
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            r = db.execute('SELECT * FROM attempts WHERE peer=?', ('ring:'+key,)).fetchone()
            count = r['count']+1 if r and r['starts'] > time.time()-60 else 1
            start = r['starts'] if count > 1 else time.time()
            db.execute('INSERT OR REPLACE INTO attempts VALUES (?,?,?)', ('ring:'+key, start, count))
            blocked = count > limit
        if blocked:
            raise HTTPException(429, 'Too many attempts. Wait one minute.')

    def exchange(self, code):
        self.throttle('token-exchange', 20)
        with self.store.connect() as db:
            db.execute('DELETE FROM ring_grants WHERE expires<?', (time.time(),))
            if not db.execute('INSERT OR IGNORE INTO ring_grants VALUES (?,?)', (digest(code), time.time()+600)).rowcount:
                return # duplicate delivery must not exchange a single-use code twice
        try:
            tokens = self.provider.grant(grant_type='authorization_code', code=code)
            profile = self.provider.api(tokens['access_token'], '/v1/users/me')
        except Exception:
            with self.store.connect() as db:
                db.execute('DELETE FROM ring_grants WHERE digest=?', (digest(code),))
            raise
        account = profile.get('data', {}).get('id')
        if not isinstance(account, str) or not account or len(account) > 200:
            raise HTTPException(502, 'Ring did not return an account identifier')
        tokens['expires_at'] = time.time()+float(tokens.get('expires_in', 14400))
        with self.store.connect() as db:
            current = db.execute('SELECT owner,state FROM ring_accounts WHERE account=?', (account,)).fetchone()
            # An existing link is replaced only by an authenticated new claim.
            if current and current['state'] == 'connected':
                raise HTTPException(409, 'Disconnect the existing account before linking again')
            db.execute('INSERT INTO ring_accounts(account,tokens,state,expires) VALUES (?,?,?,?) '
                       'ON CONFLICT(account) DO UPDATE SET tokens=excluded.tokens,state=excluded.state,expires=excluded.expires,generation=generation+1',
                       (account, self.vault.seal(tokens), 'unclaimed', time.time()+600))

    def claim(self, code, nonce, stamp):
        self.throttle('claim', 10)
        # Authenticate the SpatialGuard owner before inspecting Ring nonce matches.
        with self.store.connect() as db:
            c = db.execute('SELECT * FROM ring_codes WHERE digest=? AND expires>?', (digest(code.strip().upper()), time.time())).fetchone()
            if not c:
                raise HTTPException(401, 'Sign-in code is invalid or expired')
            owner = c['owner']
            candidates = db.execute("SELECT * FROM ring_accounts WHERE state='unclaimed' AND expires>?", (time.time(),)).fetchall()
        try:
            delta = time.time() - int(stamp)/1000
            if not 0 <= delta <= 600: raise ValueError()
        except ValueError:
            raise HTTPException(400, 'Ring link expired. Start the connection again in Ring.') from None
        key = self.provider.creds['hmac signature key'].encode()
        match = next((r for r in candidates if hmac.compare_digest(nonce, base64.urlsafe_b64encode(
            hmac.new(key, f'{stamp}:{r["account"]}'.encode(), hashlib.sha256).digest()).rstrip(b'=').decode())), None)
        if not match:
            raise HTTPException(409, 'Waiting for matching Ring credentials. Retry, or start linking again in Ring.')
        with account_lock(self.store, match['account']):
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if db.execute('SELECT 1 FROM ring_accounts WHERE owner=? AND account<>?', (owner, match['account'])).fetchone():
                    raise HTTPException(409, 'Disconnect your existing Ring account first')
                if db.execute('SELECT 1 FROM ring_nonces WHERE digest=?', (digest(nonce),)).fetchone():
                    raise HTTPException(409, 'This Ring link was already used')
                if not db.execute('DELETE FROM ring_codes WHERE digest=? AND expires>?', (digest(code.strip().upper()), time.time())).rowcount:
                    raise HTTPException(401, 'Sign-in code was already used')
                if not db.execute("UPDATE ring_accounts SET owner=?,state='linking' WHERE account=? AND state='unclaimed'", (owner, match['account'])).rowcount:
                    raise HTTPException(409, 'Ring link already claimed')
                db.execute('INSERT INTO ring_nonces VALUES (?,?)', (digest(nonce), time.time()+600))
            try:
                token = self.vault.open(match['tokens'])['access_token']
                self.provider.api(token, '/v1/accounts/me/app-integrations', 'POST', {'account_identifier': 'SpatialGuard local owner', 'nonce': nonce})
                self.provider.api(token, '/v1/accounts/me/app-integrations', 'PATCH', {'status': 'completed'})
            except Exception:
                with self.store.connect() as db:
                    db.execute("UPDATE ring_accounts SET state='relink_required' WHERE account=? AND state='linking'", (match['account'],))
                raise
            with self.store.connect() as db:
                if not db.execute("UPDATE ring_accounts SET state='connected' WHERE account=? AND state='linking'", (match['account'],)).rowcount:
                    raise HTTPException(409, 'Ring revoked this link during setup. Start again in Ring.')
                audit(db, owner, 'ring.linked', 'ring')

    def _validate_link_request(self, nonce, stamp):
        if not isinstance(nonce, str) or len(nonce) != 43:
            raise HTTPException(400, 'Ring link is invalid. Start the connection again in Ring.')
        try:
            delta = time.time() - int(stamp)/1000
            if not 0 <= delta <= 600: raise ValueError()
        except (TypeError, ValueError):
            raise HTTPException(400, 'Ring link expired. Start the connection again in Ring.') from None

    def claim_continuation(self, continuation, nonce, stamp):
        """Claim an unclaimed Ring grant for the already signed-in owner."""
        self.throttle('session-claim', 10)
        self._validate_link_request(nonce, stamp)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute(
                'SELECT * FROM ring_link_continuations WHERE digest=? AND expires>?',
                (digest(continuation), time.time()),
            ).fetchone()
            if (not row or row['nonce_digest'] != digest(nonce) or row['stamp'] != stamp or
                    not db.execute('DELETE FROM ring_link_continuations WHERE digest=?',
                                   (digest(continuation),)).rowcount):
                raise HTTPException(401, 'This signed-in continuation is invalid or expired')
            owner = row['owner']
            candidates = db.execute(
                "SELECT * FROM ring_accounts WHERE state='unclaimed' AND expires>?", (time.time(),)
            ).fetchall()
        key = self.provider.creds['hmac signature key'].encode()
        match = next((r for r in candidates if hmac.compare_digest(
            nonce,
            base64.urlsafe_b64encode(hmac.new(
                key, f'{stamp}:{r["account"]}'.encode(), hashlib.sha256
            ).digest()).rstrip(b'=').decode(),
        )), None)
        if not match:
            raise HTTPException(409, 'Waiting for matching Ring credentials. Retry, or start linking again in Ring.')
        with account_lock(self.store, match['account']):
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if db.execute('SELECT 1 FROM ring_accounts WHERE owner=? AND account<>?',
                              (owner, match['account'])).fetchone():
                    raise HTTPException(409, 'Disconnect your existing Ring account first')
                if db.execute('SELECT 1 FROM ring_nonces WHERE digest=?', (digest(nonce),)).fetchone():
                    raise HTTPException(409, 'This Ring link was already used')
                if not db.execute(
                    "UPDATE ring_accounts SET owner=?,state='linking' WHERE account=? AND state='unclaimed'",
                    (owner, match['account']),
                ).rowcount:
                    raise HTTPException(409, 'Ring link already claimed')
                db.execute('INSERT INTO ring_nonces VALUES (?,?)', (digest(nonce), time.time()+600))
            try:
                token = self.vault.open(match['tokens'])['access_token']
                self.provider.api(token, '/v1/accounts/me/app-integrations', 'POST', {
                    'account_identifier': 'SpatialGuard signed-in owner', 'nonce': nonce,
                })
                self.provider.api(token, '/v1/accounts/me/app-integrations', 'PATCH', {'status': 'completed'})
            except Exception:
                with self.store.connect() as db:
                    db.execute("UPDATE ring_accounts SET state='relink_required' WHERE account=? AND state='linking'",
                               (match['account'],))
                raise
            with self.store.connect() as db:
                if not db.execute(
                    "UPDATE ring_accounts SET state='connected' WHERE account=? AND state='linking'",
                    (match['account'],),
                ).rowcount:
                    raise HTTPException(409, 'Ring revoked this link during setup. Start again in Ring.')
                audit(db, owner, 'ring.linked', 'ring')

    def account(self, owner):
        with self.store.connect() as db:
            r = db.execute("SELECT * FROM ring_accounts WHERE owner=? AND state='connected'", (owner,)).fetchone()
        if not r:
            raise HTTPException(409, 'Link your Ring account first')
        return dict(r)

    def token(self, account):
        with account_lock(self.store, account):
            with self.store.connect() as db:
                row = db.execute("SELECT * FROM ring_accounts WHERE account=? AND state='connected'", (account,)).fetchone()
            if not row:
                raise HTTPException(401, 'Ring is disconnected')
            tokens = self.vault.open(row['tokens'])
            if tokens['expires_at'] < time.time()+600:
                try:
                    tokens = self.provider.grant(grant_type='refresh_token', refresh_token=tokens['refresh_token'])
                except HTTPException as e:
                    if e.status_code == 401:
                        self.invalidate(account)
                    raise
                tokens['expires_at'] = time.time()+float(tokens.get('expires_in', 14400))
                with self.store.connect() as db:
                    if not db.execute("UPDATE ring_accounts SET tokens=? WHERE account=? AND generation=? AND state='connected'",
                                      (self.vault.seal(tokens), account, row['generation'])).rowcount:
                        raise HTTPException(401, 'Ring was disconnected during renewal')
            return tokens['access_token']

    def invalidate(self, account):
        with self.store.connect() as db:
            db.execute("UPDATE ring_accounts SET state='revoked',tokens=NULL,generation=generation+1 WHERE account=?", (account,))
            db.execute('DELETE FROM ring_devices WHERE account=?', (account,))
            db.execute('DELETE FROM ring_account_metadata WHERE account=?', (account,))
            db.execute("UPDATE ring_streams SET state='revoked' WHERE account=?", (account,))

    def refresh_subscription(self, account):
        """Reconcile app subscription state after lifecycle webhooks or outages."""
        summary = subscription_summary(
            self.provider.api(self.token(account), '/v1/accounts/me/subscriptions')
        )
        with self.store.connect() as db:
            db.execute('INSERT INTO ring_account_metadata VALUES (?,?,?) '
                       'ON CONFLICT(account) DO UPDATE SET subscription=excluded.subscription,checked_at=excluded.checked_at',
                       (account, dump(summary), now()))
        return summary

    def devices(self, owner, refresh=False):
        a = self.account(owner)
        if not refresh:
            # Older deployments can contain valid cached devices created before
            # capability and privacy summaries were stored. Refresh those rows
            # once so the media gate has authoritative current information.
            with self.store.connect() as db:
                cached = db.execute(
                    'SELECT data FROM ring_devices WHERE account=?',
                    (a['account'],),
                ).fetchall()
            if cached and any(
                'support' not in (value := json.loads(row['data'])) or
                'configuration' not in value
                for row in cached
            ):
                return self.devices(owner, True)
        if refresh:
            token = self.token(a['account'])
            try:
                data = self.provider.api(token, '/v1/devices?include=status,capabilities,location,configurations')
                subscription = subscription_summary(
                    self.provider.api(token, '/v1/accounts/me/subscriptions')
                )
            except HTTPException as e:
                if e.status_code == 401: self.invalidate(a['account'])
                raise
            rows = data.get('data', [])
            if not isinstance(rows, list): raise HTTPException(502, 'Unexpected Ring device response')
            included = {(x['type'], x['id']): x.get('attributes', {}) for x in data.get('included', [])}
            normalized = []
            for d in rows:
                attrs = d.get('attributes', {})
                def related(name):
                    ref = d.get('relationships', {}).get(name, {}).get('data', {}) or {}
                    return included.get((ref.get('type'), ref.get('id')), {})
                status, caps, config = related('status'), related('capabilities'), related('configurations')
                support = capability_summary(caps)
                configuration = configuration_summary(config)
                guidance = list(configuration['guidance'])
                if not support['live_view']:
                    guidance.append('This authorized Ring device does not report camera video support, so live view and snapshots are unavailable.')
                normalized.append({'id': d['id'], 'name': attrs.get('description') or attrs.get('name') or 'Ring device',
                                   'status': status, 'capabilities': caps, 'checked_at': now(),
                                   'hardware_model': hardware_model(attrs), 'support': support,
                                   'configuration': configuration, 'guidance': guidance})
            with self.store.connect() as db:
                if not db.execute("SELECT 1 FROM ring_accounts WHERE account=? AND generation=? AND state='connected'", (a['account'], a['generation'])).fetchone():
                    raise HTTPException(401, 'Ring connection changed')
                ids = {d['id'] for d in normalized}
                for old in db.execute('SELECT device FROM ring_devices WHERE account=?', (a['account'],)).fetchall():
                    if old['device'] not in ids:
                        db.execute('DELETE FROM ring_devices WHERE account=? AND device=?', (a['account'], old['device']))
                        db.execute("UPDATE ring_streams SET expires=0 WHERE account=? AND device=?", (a['account'], old['device']))
                for d in normalized:
                    db.execute('INSERT INTO ring_devices(account,device,data) VALUES (?,?,?) ON CONFLICT(account,device) DO UPDATE SET data=excluded.data', (a['account'], d['id'], dump(d)))
                    online = d.get('status', {}).get('online')
                    if isinstance(online, bool):
                        self._record_health(db, a['account'], d['id'], online, 'inventory')
                db.execute('INSERT INTO ring_account_metadata VALUES (?,?,?) '
                           'ON CONFLICT(account) DO UPDATE SET subscription=excluded.subscription,checked_at=excluded.checked_at',
                           (a['account'], dump(subscription), now()))
        with self.store.connect() as db:
            return [{**json.loads(r['data']), 'site_id':r['site'], 'camera_id':r['camera']} for r in db.execute('SELECT * FROM ring_devices WHERE account=?', (a['account'],))]

    def mapping(self, owner, device, site, camera):
        a = self.account(owner)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            s = db.execute('SELECT data FROM sites WHERE id=? AND owner=?', (site, owner)).fetchone()
            if not s or camera not in [c['id'] for c in json.loads(s[0])['layout']['cameras']]:
                raise HTTPException(404, 'Camera not found in this site')
            if db.execute('SELECT 1 FROM ring_devices WHERE site=? AND camera=? AND device<>?', (site, camera, device)).fetchone():
                raise HTTPException(409, 'This camera is already mapped to a Ring device')
            if not db.execute('UPDATE ring_devices SET site=?,camera=? WHERE account=? AND device=?', (site, camera, a['account'], device)).rowcount:
                raise HTTPException(404, 'Authorized Ring device not found')
            event(db, site, 'ring.camera_mapped', camera)

    def snapshot(self, owner, site, camera):
        """Return a short-lived cached snapshot for an owner-authorized mapping."""
        account = self.account(owner)
        with self.store.connect() as db:
            mapped = db.execute(
                'SELECT * FROM ring_devices WHERE account=? AND site=? AND camera=?',
                (account['account'], site, camera),
            ).fetchone()
            authorized = db.execute(
                'SELECT 1 FROM sites WHERE id=? AND owner=?', (site, owner)
            ).fetchone()
            linked = db.execute(
                "SELECT at FROM audit WHERE owner=? AND action='ring.linked' "
                'ORDER BY id DESC LIMIT 1', (owner,)
            ).fetchone()
        if not mapped or not authorized:
            raise HTTPException(404, 'Authorized camera snapshot not found')
        cache_key = (account['account'], mapped['device'])
        cached = self._snapshots.get(cache_key)
        if cached and cached[0] > time.time():
            return cached[1:]
        device = json.loads(mapped['data'])
        support = device.get('support') or capability_summary(device.get('capabilities'))
        configuration = device.get('configuration') or configuration_summary({})
        if not support.get('snapshots'):
            raise HTTPException(409, 'This Ring device does not support camera snapshots')
        if configuration.get('privacy_zones') != 'clear':
            raise HTTPException(409, 'Camera media is blocked until Ring privacy-zone status is clear')
        components = device.get('capabilities', {}).get('components', {}).get('items', [])
        component = None
        if isinstance(components, list) and len(components) == 1:
            candidate = components[0]
            if isinstance(candidate, dict):
                component = candidate.get('component_id')
        # Ring rejects any range that begins before this app received consent,
        # even when the range ends after consent. The local link audit is later
        # than consent and is therefore a safe lower bound.
        consent_floor = None
        if linked:
            consent_floor = int(
                datetime.fromisoformat(linked['at']).timestamp() * 1000
            ) + 1000
        image, content_type, metadata = self.provider.snapshot(
            self.token(account['account']), mapped['device'], component,
            consent_floor,
        )
        result = (image, content_type, metadata)
        self._snapshots[cache_key] = (time.time() + 30, *result)
        return result

    def webhook(self, raw, signature):
        started = time.perf_counter()
        expected = 'sha256=' + hmac.new(self.provider.creds['hmac signature key'].encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise HTTPException(401, 'Invalid Ring signature')
        try:
            p = json.loads(raw); meta = p['meta']; d = p['data']; attrs = d.get('attributes', {})
            account = meta['account_id']; rid = meta['request_id']; kind = d['type']
            device = attrs.get('source', ''); subtype = attrs.get('sub_type', '')
            stamp = datetime.fromtimestamp(float(attrs['timestamp'])/1000, timezone.utc).isoformat()
            if not all(isinstance(v, str) and len(v) <= 300 for v in (account, rid, kind, device, subtype)): raise ValueError()
            if not rid or not account: raise ValueError()
        except (KeyError, ValueError, TypeError, OverflowError):
            raise HTTPException(400, 'Malformed Ring event') from None
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            event_id = digest(account + ':' + str(d.get('id') or rid))
            if db.execute('SELECT 1 FROM ring_inbox WHERE id=?', (event_id,)).fetchone():
                self._metric(db, account, 'duplicates_suppressed', count=1)
                self._metric(db, account, 'webhook_ack_ms', (time.perf_counter()-started)*1000)
                return
            a = db.execute("SELECT * FROM ring_accounts WHERE account=? AND state='connected'", (account,)).fetchone()
            consent = bool(a and account_preferences(db, a['owner'])['ring_data_consent'])
            # Keep only a provider revocation after permission is withdrawn so
            # local credentials can be invalidated. All camera event content is
            # discarded before it enters the inbox.
            if not consent and kind != 'app_integration_removed':
                return
            mapping = db.execute('SELECT * FROM ring_devices WHERE account=? AND device=?', (account, device)).fetchone()
            snapshot = None
            if a and mapping and mapping['site']:
                s = db.execute('SELECT data FROM sites WHERE id=? AND owner=?', (mapping['site'], a['owner'])).fetchone()
                if s:
                    site = json.loads(s[0])
                    if site['monitoring']['enabled'] and mapping['camera'] in site['monitoring']['camera_ids']:
                        snapshot = dump({'site':site['id'], 'revision':site['revision_id'], 'camera':mapping['camera'],
                                         'monitoring_version':site.get('monitoring_version',0), 'generation':a['generation']})
            db.execute('INSERT INTO ring_inbox(id,account,device,kind,at,received,subtype,state,snapshot,provider_request) VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (event_id, account, device, kind, stamp, now(), subtype, 'queued', snapshot, digest(rid)))
            if kind == 'app_integration_removed':
                db.execute("UPDATE ring_accounts SET state='revoked',tokens=NULL,generation=generation+1 WHERE account=?", (account,))
                db.execute('DELETE FROM ring_devices WHERE account=?', (account,))
                db.execute("UPDATE ring_streams SET state='revoked' WHERE account=?", (account,))
            elif kind == 'device_removed':
                db.execute('DELETE FROM ring_devices WHERE account=? AND device=?', (account, device))
                db.execute('UPDATE ring_streams SET expires=0 WHERE account=? AND device=?', (account, device))
            elif kind == 'device_offline':
                db.execute('UPDATE ring_streams SET expires=0 WHERE account=? AND device=?', (account, device))
                self._record_health(db, account, device, False, 'webhook')
            elif kind == 'device_online':
                self._record_health(db, account, device, True, 'webhook')
            self._metric(db, account, 'webhook_ack_ms', (time.perf_counter()-started)*1000)

    def operations(self, owner):
        account = self.account(owner)
        cutoff = time.time() - 7 * 86400
        with self.store.connect() as db:
            devices = db.execute('SELECT * FROM ring_devices WHERE account=?', (account['account'],)).fetchall()
            preference = db.execute('SELECT * FROM ring_ops_preferences WHERE owner=?', (owner,)).fetchone()
            if not preference:
                db.execute('INSERT INTO ring_ops_preferences(owner) VALUES (?)', (owner,))
                preference = db.execute('SELECT * FROM ring_ops_preferences WHERE owner=?', (owner,)).fetchone()
            wall = db.execute('SELECT devices FROM ring_camera_wall WHERE owner=?', (owner,)).fetchone()
            alerts = db.execute(
                'SELECT * FROM ring_alerts WHERE owner=? AND notify_at<=? ORDER BY at DESC LIMIT 100',
                (owner, time.time()),
            ).fetchall()
            projects = db.execute(
                'SELECT * FROM timelapse_projects WHERE owner=? ORDER BY created DESC', (owner,)
            ).fetchall()
            incident_rows = db.execute(
                'SELECT i.data FROM incidents i JOIN sites s ON s.id=i.site_id '
                'WHERE s.owner=? ORDER BY i.seq DESC LIMIT 12', (owner,)
            ).fetchall()
            result_devices = []
            for row in devices:
                history = db.execute(
                    'SELECT at,online,source FROM ring_health WHERE account=? AND device=? AND at>=? ORDER BY at',
                    (account['account'], row['device'], cutoff),
                ).fetchall()
                before = db.execute(
                    'SELECT at,online,source FROM ring_health WHERE account=? AND device=? AND at<? ORDER BY at DESC LIMIT 1',
                    (account['account'], row['device'], cutoff),
                ).fetchone()
                points = ([dict(before) | {'at': cutoff}] if before else []) + [dict(item) for item in history]
                data = json.loads(row['data'])
                if points:
                    online = bool(points[-1]['online'])
                else:
                    online = bool(data.get('status', {}).get('online', False))
                cursor, online_seconds = cutoff, 0.0
                state = bool(points[0]['online']) if points else online
                for point in points[1:]:
                    if state: online_seconds += max(0, point['at'] - cursor)
                    cursor, state = point['at'], bool(point['online'])
                if state: online_seconds += max(0, time.time() - cursor)
                result_devices.append({
                    **data, 'site_id': row['site'], 'camera_id': row['camera'], 'online': online,
                    'uptime_percent': round(online_seconds / (7 * 86400) * 100, 1) if points else None,
                    'history': [{'at': datetime.fromtimestamp(p['at'], timezone.utc).isoformat(),
                                 'online': bool(p['online']), 'source': p['source']} for p in points],
                })
            counts = {row['id']: db.execute(
                'SELECT count(*) FROM timelapse_frames WHERE project=?', (row['id'],)
            ).fetchone()[0] for row in projects}
            frames = {row['id']: [dict(frame) for frame in db.execute(
                'SELECT id,at FROM timelapse_frames WHERE project=? ORDER BY at DESC LIMIT 12',
                (row['id'],)
            ).fetchall()] for row in projects}
            motion_events = []
            for row in incident_rows:
                incident = json.loads(row['data'])
                if incident.get('evidence_mode') != 'live':
                    continue
                motion_events.append({
                    'id': incident['id'], 'title': incident['title'],
                    'started_at': incident['started_at'], 'site_id': incident['site_id'],
                    'cameras': list(dict.fromkeys(
                        item['source_id'] for item in incident.get('observations', [])
                    )),
                    'clip_available': False,
                })
        return {
            'devices': result_devices,
            'alerts': [dict(row) for row in alerts],
            'preferences': dict(preference),
            'wall': json.loads(wall['devices']) if wall else [d['id'] for d in result_devices[:16]],
            'projects': [{**dict(row), 'frame_count': counts[row['id']],
                          'frames': frames[row['id']]} for row in projects],
            'motion_events': motion_events,
        }

    def update_operations_preferences(self, owner, values):
        delay = max(0, min(3600, int(values.get('delay_seconds', 0))))
        email = str(values.get('email', '')).strip()[:254]
        with self.store.connect() as db:
            db.execute('INSERT INTO ring_ops_preferences VALUES (?,?,?,?,?) '
                       'ON CONFLICT(owner) DO UPDATE SET delay_seconds=excluded.delay_seconds, '
                       'browser_enabled=excluded.browser_enabled,email_enabled=excluded.email_enabled,email=excluded.email',
                       (owner, delay, int(bool(values.get('browser_enabled'))),
                        int(bool(values.get('email_enabled'))), email))

    def save_camera_wall(self, owner, devices):
        account = self.account(owner)
        unique = list(dict.fromkeys(devices))[:16]
        with self.store.connect() as db:
            allowed = {row['device'] for row in db.execute(
                'SELECT device FROM ring_devices WHERE account=?', (account['account'],)
            )}
            if not set(unique) <= allowed:
                raise HTTPException(422, 'Camera wall contains an unauthorized device')
            db.execute('INSERT INTO ring_camera_wall VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET devices=excluded.devices',
                       (owner, dump(unique)))

    def acknowledge_alert(self, owner, alert_id):
        with self.store.connect() as db:
            if not db.execute('UPDATE ring_alerts SET acknowledged=1 WHERE id=? AND owner=?',
                              (alert_id, owner)).rowcount:
                raise HTTPException(404, 'Alert not found')

    def create_timelapse(self, owner, values):
        account = self.account(owner)
        try: ZoneInfo(values['timezone'])
        except ZoneInfoNotFoundError: raise HTTPException(422, 'Unknown time zone') from None
        with self.store.connect() as db:
            mapped = db.execute('SELECT 1 FROM ring_devices WHERE account=? AND device=? AND site=? AND camera=?',
                (account['account'], values['device'], values['site'], values['camera'])).fetchone()
            if not mapped: raise HTTPException(404, 'Map this authorized camera first')
            if db.execute('SELECT count(*) FROM timelapse_projects WHERE owner=?', (owner,)).fetchone()[0] >= 8:
                raise HTTPException(409, 'Eight time-lapse projects are already configured')
            project = uid('timelapse')
            db.execute('INSERT INTO timelapse_projects VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (project, owner, values['device'], values['site'], values['camera'], values['name'][:80],
                 values['cadence_minutes'], values['start_hour'], values['end_hour'], values['timezone'],
                 1, time.time(), time.time()))
            return project

    def capture_timelapse(self, owner, project_id):
        with self.store.connect() as db:
            project = db.execute('SELECT * FROM timelapse_projects WHERE id=? AND owner=?',
                                 (project_id, owner)).fetchone()
        if not project: raise HTTPException(404, 'Time-lapse project not found')
        image, media_type, _ = self.snapshot(owner, project['site'], project['camera'])
        frame_id = uid('frame')
        extension = '.png' if media_type == 'image/png' else '.jpg'
        folder = DATA / 'timelapse' / project_id
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / (frame_id + extension)
        path.write_bytes(image)
        with self.store.connect() as db:
            db.execute('INSERT INTO timelapse_frames VALUES (?,?,?,?,?)',
                       (frame_id, project_id, time.time(), str(path), media_type))
            old = db.execute('SELECT id,path FROM timelapse_frames WHERE project=? ORDER BY at DESC LIMIT -1 OFFSET 500',
                             (project_id,)).fetchall()
            for row in old:
                try: Path(row['path']).unlink(missing_ok=True)
                except OSError: pass
                db.execute('DELETE FROM timelapse_frames WHERE id=?', (row['id'],))
        return frame_id

    def timelapse_frame(self, owner, project_id, frame_id):
        with self.store.connect() as db:
            row = db.execute('SELECT f.* FROM timelapse_frames f JOIN timelapse_projects p ON p.id=f.project '
                             'WHERE f.id=? AND f.project=? AND p.owner=?',
                             (frame_id, project_id, owner)).fetchone()
        if not row or not Path(row['path']).is_file(): raise HTTPException(404, 'Frame not found')
        return Path(row['path']).read_bytes(), row['media_type']

    def timelapse_reel(self, owner, project_id):
        from PIL import Image
        with self.store.connect() as db:
            rows = db.execute('SELECT f.path FROM timelapse_frames f JOIN timelapse_projects p ON p.id=f.project '
                              'WHERE f.project=? AND p.owner=? ORDER BY f.at DESC LIMIT 120',
                              (project_id, owner)).fetchall()
        if not rows: raise HTTPException(409, 'Capture at least one frame first')
        images = []
        for row in reversed(rows):
            with Image.open(row['path']) as source:
                frame = source.convert('RGB'); frame.thumbnail((960, 540)); images.append(frame.copy())
        output = BytesIO()
        images[0].save(output, format='GIF', save_all=True, append_images=images[1:], duration=500, loop=0)
        return output.getvalue()

    def delete_timelapse(self, owner, project_id):
        with self.store.connect() as db:
            if not db.execute('DELETE FROM timelapse_projects WHERE id=? AND owner=?',
                              (project_id, owner)).rowcount:
                raise HTTPException(404, 'Time-lapse project not found')
            db.execute('DELETE FROM timelapse_frames WHERE project=?', (project_id,))
        shutil.rmtree(DATA / 'timelapse' / project_id, ignore_errors=True)

    def timelapse_tick(self):
        with self.store.connect() as db:
            rows = db.execute('SELECT * FROM timelapse_projects WHERE enabled=1 AND next_capture<=? LIMIT 2',
                              (time.time(),)).fetchall()
        for row in rows:
            with self.store.connect() as db:
                permitted = account_preferences(db, row['owner'])['ring_data_consent']
            if not permitted:
                continue
            try:
                hour = datetime.now(ZoneInfo(row['timezone'])).hour
                inside = (row['start_hour'] <= hour < row['end_hour']) if row['start_hour'] < row['end_hour'] else (
                    hour >= row['start_hour'] or hour < row['end_hour'])
                if inside: self.capture_timelapse(row['owner'], row['id'])
            except Exception:
                pass
            with self.store.connect() as db:
                db.execute('UPDATE timelapse_projects SET next_capture=? WHERE id=?',
                           (time.time() + row['cadence_minutes'] * 60, row['id']))

    def deliver_email_alerts(self):
        host = os.environ.get('SPATIALGUARD_SMTP_HOST')
        sender = os.environ.get('SPATIALGUARD_SMTP_FROM')
        if not host or not sender: return
        with self.store.connect() as db:
            rows = db.execute("SELECT a.*,p.email FROM ring_alerts a JOIN ring_ops_preferences p ON p.owner=a.owner "
                "WHERE a.notify_at<=? AND a.emailed=0 AND p.email_enabled=1 AND p.email<>'' LIMIT 8",
                (time.time(),)).fetchall()
        for row in rows:
            with self.store.connect() as db:
                if not account_preferences(db, row['owner'])['ring_data_consent']:
                    continue
            try:
                message = EmailMessage(); message['From']=sender; message['To']=row['email']
                message['Subject'] = 'Ring camera offline' if row['kind']=='offline' else 'Ring camera recovered'
                message.set_content('SpatialGuard observed a Ring device status change. Open the Operations page for details.\n\nThis is a convenience alert, not a security or life-safety notification.')
                with smtplib.SMTP(host, int(os.environ.get('SPATIALGUARD_SMTP_PORT','587')), timeout=15) as smtp:
                    smtp.starttls(); user=os.environ.get('SPATIALGUARD_SMTP_USER'); password=os.environ.get('SPATIALGUARD_SMTP_PASSWORD')
                    if user and password: smtp.login(user,password)
                    smtp.send_message(message)
                with self.store.connect() as db: db.execute('UPDATE ring_alerts SET emailed=1 WHERE id=?',(row['id'],))
            except Exception:
                pass

    def stream(self, owner, device, sdp):
        if not sdp.startswith('v=0') or 'm=audio' in sdp or 'a=sendrecv' in sdp or 'a=sendonly' in sdp or 'm=video' not in sdp:
            raise HTTPException(400, 'Use a receive-only, video-only SDP offer')
        a = self.account(owner)
        token = self.token(a['account'])
        sid = uid('ring_media')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            d = db.execute('SELECT * FROM ring_devices WHERE account=? AND device=?', (a['account'], device)).fetchone()
            if not d: raise HTTPException(404, 'Authorized camera not found')
            data = json.loads(d['data'])
            support = data.get('support') or capability_summary(data.get('capabilities'))
            configuration = data.get('configuration') or configuration_summary({})
            if not support.get('live_view'):
                raise HTTPException(409, 'Live view is unavailable for this Ring device')
            if configuration.get('privacy_zones') != 'clear':
                raise HTTPException(409, 'Live view is blocked until Ring privacy-zone status is clear')
            if not d['site'] or not db.execute('SELECT 1 FROM sites WHERE id=? AND owner=?', (d['site'], owner)).fetchone():
                raise HTTPException(409, 'Map this device to your floor plan first')
            # A browser reload can cancel its best-effort DELETE. Do not let an
            # already expired local lease block the replacement Ring session.
            if db.execute("SELECT 1 FROM ring_streams WHERE account=? AND device=? AND state IN ('opening','active','closing') AND expires>?", (a['account'], device, time.time())).fetchone():
                raise HTTPException(409, 'A stream is already open or closing for this camera')
            db.execute('INSERT INTO ring_streams VALUES (?,?,?,?,?,?,?)', (sid, a['account'], device, owner, None, time.time()+30, 'opening'))
        try:
            answer, path = self.provider.stream(token, device, sdp)
            with self.store.connect() as db:
                valid = db.execute("SELECT 1 FROM ring_accounts WHERE account=? AND state='connected' AND generation=?", (a['account'], a['generation'])).fetchone()
                valid = valid and db.execute('SELECT 1 FROM ring_devices WHERE account=? AND device=?', (a['account'], device)).fetchone()
                db.execute('UPDATE ring_streams SET path=?,state=?,expires=? WHERE id=?', (path, 'active' if valid else 'closing', time.time()+25 if valid else 0, sid))
            if not valid:
                self.provider.close(token, path)
                raise HTTPException(401, 'Camera access changed during stream setup')
            return {'id':sid, 'sdp':answer, 'expires_at':time.time()+25}
        except Exception:
            with self.store.connect() as db:
                db.execute("UPDATE ring_streams SET state='failed' WHERE id=? AND state='opening'", (sid,))
            raise

    def close_stream(self, owner, sid):
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM ring_streams WHERE id=? AND owner=?', (sid, owner)).fetchone()
            if not row: raise HTTPException(404, 'Stream not found')
            if row['state'] in ('closed', 'revoked', 'failed'): return
            db.execute("UPDATE ring_streams SET expires=0,state='closing' WHERE id=?", (sid,))
        if row['path']:
            try:
                self.provider.close(self.token(row['account']), row['path'])
            except HTTPException as e:
                if e.status_code != 401: raise
        with self.store.connect() as db:
            db.execute("UPDATE ring_streams SET state='closed' WHERE id=?", (sid,))

    def disconnect(self, owner):
        with self.store.connect() as db:
            existing = db.execute('SELECT * FROM ring_accounts WHERE owner=?', (owner,)).fetchone()
        if not existing: return
        a = dict(existing)
        if a['state'] != 'connected':
            self.invalidate(a['account'])
            with self.store.connect() as db:
                db.execute('UPDATE ring_accounts SET owner=NULL WHERE account=?', (a['account'],))
            return
        with self.store.connect() as db:
            streams = db.execute("SELECT id FROM ring_streams WHERE owner=? AND state IN ('active','opening','closing')", (owner,)).fetchall()
        for s in streams: self.close_stream(owner, s['id'])
        # Provider supports pause, not unilateral removal. Owner can remove it in Ring.
        self.provider.api(self.token(a['account']), '/v1/accounts/me/app-integrations', 'PATCH', {'status':'awaiting'})
        self.invalidate(a['account'])
        with self.store.connect() as db:
            db.execute('UPDATE ring_accounts SET owner=NULL WHERE account=?', (a['account'],))

    def cleanup(self):
        with self.store.connect() as db:
            rows = db.execute("SELECT * FROM ring_streams WHERE expires<? AND state IN ('opening','active','closing') LIMIT 8", (time.time(),)).fetchall()
            db.execute("DELETE FROM ring_accounts WHERE state='unclaimed' AND expires<?", (time.time(),))
            db.execute('DELETE FROM ring_codes WHERE expires<?', (time.time(),))
            db.execute('DELETE FROM ring_nonces WHERE expires<?', (time.time(),))
            db.execute('DELETE FROM ring_link_continuations WHERE expires<?', (time.time(),))
        for row in rows:
            try: self.close_stream(row['owner'], row['id'])
            except HTTPException: pass # retry cleanup; Ring also imposes its own bounded expiry
        self.timelapse_tick()
        self.deliver_email_alerts()
