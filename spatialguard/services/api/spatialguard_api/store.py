import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("SPATIALGUARD_DATA_DIR", ROOT / ".data")) / "spatialguard"


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix + "_" + secrets.token_hex(10)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def dump(value):
    return json.dumps(value, separators=(",", ":"))


DEFAULT_ACCOUNT_PREFERENCES = {
    "onboarding_completed": False,
    "ring_data_consent": False,
    "classification_consent": False,
    "incident_retention_days": 90,
    "audit_retention_days": 365,
    "consent_updated_at": None,
}


def account_preferences(db, owner, create=True):
    """Return privacy preferences for an account.

    Legacy local workspaces never see account onboarding, but their data
    permissions still start disabled and must be enabled explicitly in
    Settings before Ring linking or snapshot classification.
    """
    account = db.execute("SELECT 1 FROM accounts WHERE id=?", (owner,)).fetchone()
    row = db.execute("SELECT * FROM account_preferences WHERE owner=?", (owner,)).fetchone()
    if not row and account and create:
        db.execute("INSERT INTO account_preferences(owner) VALUES (?)", (owner,))
        row = db.execute("SELECT * FROM account_preferences WHERE owner=?", (owner,)).fetchone()
    if not row:
        result = dict(DEFAULT_ACCOUNT_PREFERENCES)
        result["onboarding_completed"] = not bool(account)
        # A pre-account local preview may already have an owner-authorized Ring
        # integration from earlier builds. Preserve that existing permission as
        # a migration; new email accounts always start with both choices off.
        if not account and db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ring_accounts'"
        ).fetchone():
            linked = db.execute(
                "SELECT 1 FROM ring_accounts WHERE owner=? AND state='connected'", (owner,)
            ).fetchone()
            result["ring_data_consent"] = bool(linked)
            if linked:
                for site_row in db.execute("SELECT data FROM sites WHERE owner=?", (owner,)):
                    try:
                        if json.loads(site_row["data"]).get("monitoring", {}).get("classification_enabled"):
                            result["classification_consent"] = True
                            break
                    except (TypeError, json.JSONDecodeError):
                        continue
        return result
    result = dict(row)
    result.pop("owner", None)
    for key in ("onboarding_completed", "ring_data_consent", "classification_consent"):
        result[key] = bool(result[key])
    return result


def cleanup_retention(store):
    """Apply each owner's incident and audit retention choices.

    Cleanup is intentionally independent from provider processing. An expired
    incident removes its replay evidence and event notification together, but
    it never changes the immutable TwinForge revision pinned by newer records.
    """
    removed_incidents = 0
    removed_audit = 0
    current = datetime.now(timezone.utc)
    with store.connect() as db:
        owners = db.execute("SELECT owner FROM account_preferences").fetchall()
        for owner_row in owners:
            owner = owner_row["owner"]
            preferences = account_preferences(db, owner, create=False)
            sites = [row["id"] for row in db.execute(
                "SELECT id FROM sites WHERE owner=?", (owner,)
            )]
            incident_cutoff = current - timedelta(days=preferences["incident_retention_days"])
            for site_id in sites:
                rows = db.execute(
                    "SELECT id,run_id,data FROM incidents WHERE site_id=?", (site_id,)
                ).fetchall()
                for row in rows:
                    try:
                        created = datetime.fromisoformat(json.loads(row["data"])["created_at"].replace("Z", "+00:00"))
                    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                        continue
                    if created >= incident_cutoff:
                        continue
                    evidence_rows = db.execute(
                        "SELECT id,data FROM evidence WHERE site_id=?", (site_id,)
                    ).fetchall()
                    for evidence_row in evidence_rows:
                        try:
                            belongs = json.loads(evidence_row["data"]).get("incident_id") == row["id"]
                        except (TypeError, json.JSONDecodeError):
                            belongs = False
                        if belongs:
                            db.execute("DELETE FROM evidence WHERE id=?", (evidence_row["id"],))
                    db.execute("DELETE FROM events WHERE site_id=? AND resource=?", (site_id, row["id"]))
                    db.execute("DELETE FROM observation_tracks WHERE incident_id=?", (row["id"],))
                    db.execute("DELETE FROM incidents WHERE id=?", (row["id"],))
                    db.execute("DELETE FROM runs WHERE id=? AND site_id=?", (row["run_id"], site_id))
                    removed_incidents += 1
            audit_cutoff = (current - timedelta(days=preferences["audit_retention_days"])).isoformat()
            result = db.execute("DELETE FROM audit WHERE owner=? AND at<?", (owner, audit_cutoff))
            removed_audit += result.rowcount
    return {"incidents": removed_incidents, "audit_records": removed_audit}


class Store:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get("SPATIALGUARD_DB", DATA / "app.sqlite3"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL, created TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS account_preferences (
                owner TEXT PRIMARY KEY,
                onboarding_completed INTEGER NOT NULL DEFAULT 0,
                ring_data_consent INTEGER NOT NULL DEFAULT 0,
                classification_consent INTEGER NOT NULL DEFAULT 0,
                incident_retention_days INTEGER NOT NULL DEFAULT 90,
                audit_retention_days INTEGER NOT NULL DEFAULT 365,
                consent_updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, digest TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL, kind TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS pairing (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS attempts (peer TEXT PRIMARY KEY, starts REAL NOT NULL, count INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, request_id TEXT NOT NULL,
                state TEXT NOT NULL, payload TEXT NOT NULL, lease REAL NOT NULL DEFAULT 0,
                attempts INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(site_id,request_id));
            CREATE TABLE IF NOT EXISTS incidents (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                site_id TEXT NOT NULL, run_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS live_incident_accounts (
                incident_id TEXT PRIMARY KEY, account_digest TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS plans (job_id TEXT PRIMARY KEY, owner TEXT NOT NULL,
                engine_site TEXT NOT NULL, name TEXT NOT NULL, at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL,
                kind TEXT NOT NULL, resource TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
                action TEXT NOT NULL, resource TEXT NOT NULL, at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS auth_tokens (
                digest TEXT PRIMARY KEY, owner TEXT NOT NULL, purpose TEXT NOT NULL,
                expires REAL NOT NULL, used_at TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS data_access_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
                actor TEXT NOT NULL, action TEXT NOT NULL, device TEXT NOT NULL,
                purpose TEXT NOT NULL, result TEXT NOT NULL, at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS deletion_receipts (
                reference TEXT PRIMARY KEY, requested_at TEXT NOT NULL,
                completed_at TEXT NOT NULL, categories TEXT NOT NULL,
                downstream TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notification_preferences (
                owner TEXT PRIMARY KEY, incident_email INTEGER NOT NULL DEFAULT 1,
                operational_email INTEGER NOT NULL DEFAULT 1,
                weekly_summary INTEGER NOT NULL DEFAULT 0,
                marketing INTEGER NOT NULL DEFAULT 0
            );
            -- Person path detected in a live event's recording (see tracks.py):
            -- the analysis queue and its result. Points are [t, foot_x, foot_y,
            -- confidence] in image coordinates; the recording is never kept.
            CREATE TABLE IF NOT EXISTS observation_tracks (
                incident_id TEXT NOT NULL, observation_id TEXT NOT NULL, site_id TEXT NOT NULL,
                camera_id TEXT NOT NULL, observed_at TEXT NOT NULL,
                state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, not_before REAL NOT NULL DEFAULT 0,
                lease REAL, points TEXT, detector TEXT, updated TEXT,
                PRIMARY KEY (incident_id, observation_id)
            );
            CREATE INDEX IF NOT EXISTS observation_tracks_due ON observation_tracks(state, not_before);
            CREATE INDEX IF NOT EXISTS observation_tracks_site ON observation_tracks(site_id);
            -- Weekly AI summary of a site's analytics (Amazon Bedrock); aggregate numbers only.
            CREATE TABLE IF NOT EXISTS site_insights (
                id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL,
                created TEXT NOT NULL, data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS site_insights_site ON site_insights(site_id, id);
            -- Queue and crowding alerts (alerts.py): owner limits and raised alerts.
            CREATE TABLE IF NOT EXISTS site_alert_settings (site_id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS site_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, zone TEXT NOT NULL,
                kind TEXT NOT NULL, count INTEGER NOT NULL, alert_limit INTEGER NOT NULL,
                window_minutes INTEGER NOT NULL, at TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS site_alerts_site ON site_alerts(site_id, id);
            CREATE TABLE IF NOT EXISTS notification_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
                category TEXT NOT NULL, channel TEXT NOT NULL, state TEXT NOT NULL,
                detail TEXT NOT NULL, at TEXT NOT NULL
            );
            ''')
            account_columns = {row['name'] for row in db.execute('PRAGMA table_info(accounts)')}
            if 'email_verified' not in account_columns:
                db.execute('ALTER TABLE accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()


def event(db, site, kind, resource):
    db.execute("INSERT INTO events(site_id,kind,resource) VALUES (?,?,?)", (site, kind, resource))


def audit(db, owner, action, resource):
    db.execute("INSERT INTO audit(owner,action,resource,at) VALUES (?,?,?,?)", (owner, action, resource, now()))


def access_log(db, owner, actor, action, device, purpose, result="allowed"):
    """Append an owner-visible, token-free record of sensitive data access."""
    db.execute(
        "INSERT INTO data_access_log(owner,actor,action,device,purpose,result,at) VALUES (?,?,?,?,?,?,?)",
        (owner, actor, action, device, purpose, result, now()),
    )
