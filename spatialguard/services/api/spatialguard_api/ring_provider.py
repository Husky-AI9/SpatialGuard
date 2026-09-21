"""Official Ring transport. Never expose tokens, remote response bodies or URLs to clients."""
import csv
import json
import os
import urllib.request
import urllib.parse
import urllib.error
import time
from pathlib import Path
from fastapi import HTTPException
from .store import ROOT

BASE = 'https://api.amazonvision.com'


def _record_invalid_media_location(location, url, expected):
    """Record URL shape only; never persist device/session IDs, SDP, or tokens."""
    known = {'v1', 'devices', 'media', 'streaming', 'whep', 'sessions'}
    segments = [part if part in known else f'<opaque:{len(part)}>'
                for part in url.path.split('/') if part]
    target = ROOT / '.data/spatialguard/ring-media-location-debug.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({
        'checked_at': int(time.time()),
        'location_present': bool(location),
        'location_kind': ('absolute' if urllib.parse.urlparse(location).scheme else
                          'root_relative' if location.startswith('/') else 'relative'),
        'scheme': url.scheme,
        'host': url.netloc,
        'path_segments': segments,
        'matches_expected_collection': url.path.startswith(expected + '/'),
        'has_query': bool(url.query),
        'query_keys': sorted({key for key, _ in urllib.parse.parse_qsl(url.query)}),
        'has_fragment': bool(url.fragment),
    }, indent=2), encoding='utf-8')


def credentials():
    configured = {
        'client id': os.environ.get('RING_CLIENT_ID', '').strip(),
        'client secret': os.environ.get('RING_CLIENT_SECRET', '').strip(),
        'hmac signature key': (
            os.environ.get('RING_HMAC_SIGNATURE_KEY', '').strip()
            or os.environ.get('RING_WEBHOOK_SECRET', '').strip()
        ),
    }
    if all(configured.values()):
        return configured
    path = ROOT / '.data/ring-app-credentials.csv'
    if not path.exists():
        raise HTTPException(503, 'Ring app credentials are not configured')
    with path.open(encoding='utf-8-sig') as f:
        values = {r[0].strip().lower(): r[1].strip() for r in csv.reader(f) if len(r) >= 2}
    if not all(values.get(k) for k in ('client id', 'client secret', 'hmac signature key')):
        raise HTTPException(503, 'Ring credentials CSV is incomplete')
    return values


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Provider:
    def __init__(self, creds=None):
        self.creds = creds or credentials()

    def send(self, url, method, body=None, token=None, content_type='application/json',
             accepted_statuses=()):
        # Ring's OAuth edge rejects urllib's default Python user agent before it
        # evaluates otherwise valid OAuth requests (Cloudflare Error 1010).
        headers = {'Content-Type': content_type, 'Accept': 'application/json, */*',
                   'User-Agent': 'SpatialGuard-Ring-Partner/1.0'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        data = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as r:
                return r.read(2_000_000), dict(r.headers)
        except urllib.error.HTTPError as e:
            if e.code in accepted_statuses:
                return e.read(2_000_000), dict(e.headers)
            if e.code in (401, 403):
                raise HTTPException(401, 'Ring access expired or was revoked. Link the account again.') from None
            raise HTTPException(503, 'Ring could not complete this request. Retry shortly.') from None
        except OSError:
            raise HTTPException(503, 'Ring is unreachable. Check your internet connection.') from None

    def grant(self, **fields):
        body = urllib.parse.urlencode({**fields, 'client_id': self.creds['client id'],
                                      'client_secret': self.creds['client secret']}).encode()
        raw, _ = self.send('https://oauth.ring.com/oauth/token', 'POST', body,
                           content_type='application/x-www-form-urlencoded')
        result = json.loads(raw)
        if not result.get('access_token') or not result.get('refresh_token'):
            raise HTTPException(502, 'Ring did not return usable credentials')
        return result

    def api(self, token, path, method='GET', body=None):
        parsed = urllib.parse.urlsplit(path)
        if (parsed.scheme or parsed.netloc or parsed.fragment or
                not parsed.path.startswith('/v1/') or '\\' in parsed.path):
            raise ValueError('Invalid Ring API path')
        raw, _ = self.send(BASE + path, method, body, token)
        return json.loads(raw) if raw else {}

    def stream(self, token, device, sdp):
        path = '/v1/devices/' + urllib.parse.quote(device, safe='') + '/media/streaming/whep/sessions'
        raw, headers = self.send(BASE + path, 'POST', sdp.encode(), token, 'application/sdp')
        location = next((v for k, v in headers.items() if k.lower() == 'location'), '')
        # WHEP permits Location to be an absolute URL, a root-relative URL, or
        # a relative session reference. Resolve it against the collection URL,
        # while still requiring the resulting close URL to stay on Ring's API
        # host and directly below this camera's session collection.
        url = urllib.parse.urlparse(urllib.parse.urljoin(BASE + path + '/', location))
        session = url.path.removeprefix(path + '/')
        try:
            query = urllib.parse.parse_qsl(
                url.query, keep_blank_values=True, max_num_fields=2
            )
        except ValueError:
            query = [('', '')]
        valid_query = not query or (
            len(query) == 1 and query[0][0] == 'location' and
            bool(query[0][1]) and len(query[0][1]) <= 512
        )
        if (url.scheme != 'https' or url.netloc != 'api.amazonvision.com' or
                not session or '/' in session or '\\' in session or
                not valid_query or url.fragment):
            _record_invalid_media_location(location, url, path)
            raise HTTPException(502, 'Ring returned an invalid media session')
        resource = url.path + (('?' + url.query) if url.query else '')
        return raw.decode(), resource

    def snapshot(self, token, device, component=None, start_timestamp=None):
        """Download the latest Ring snapshot without exposing its signed URL."""
        path = '/v1/devices/' + urllib.parse.quote(device, safe='') + '/media/image/download'
        end = int(time.time() * 1000)
        body = {
            'type': 'latest_in_range',
            'start_timestamp': max(
                end - 24 * 60 * 60 * 1000,
                int(start_timestamp or 0),
            ),
            'end_timestamp': end,
            'image_options': {'format': 'jpeg'},
        }
        if component:
            body['components'] = [{'component_id': component}]
        _, headers = self.send(
            BASE + path, 'POST', body, token, accepted_statuses=(303,)
        )
        location = next((v for k, v in headers.items() if k.lower() == 'location'), '')
        url = urllib.parse.urlparse(location)
        host = (url.hostname or '').lower()
        if (url.scheme != 'https' or not host or url.username or url.password or
                url.port not in (None, 443) or url.fragment or
                not (host == 'api.amazonvision.com' or
                     host.endswith('.amazonvision.com') or
                     host.endswith('.devices.amazon.dev'))):
            raise HTTPException(502, 'Ring returned an invalid snapshot location')
        request = urllib.request.Request(location, headers={
            'Accept': 'image/jpeg, image/png',
            'User-Agent': 'SpatialGuard-Ring-Partner/1.0',
        }, method='GET')
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                image = response.read(8_000_001)
                image_headers = dict(response.headers)
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise HTTPException(503, 'The latest Ring snapshot expired. Retry shortly.') from None
            raise HTTPException(503, 'Ring could not download the latest snapshot.') from None
        except OSError:
            raise HTTPException(503, 'Ring snapshot download is unreachable.') from None
        if len(image) > 8_000_000:
            raise HTTPException(502, 'Ring snapshot is too large')
        content_type = next(
            (v.split(';', 1)[0].strip().lower() for k, v in image_headers.items()
             if k.lower() == 'content-type'), ''
        )
        if content_type not in ('image/jpeg', 'image/png'):
            raise HTTPException(502, 'Ring returned an unsupported snapshot format')
        return image, content_type, {
            key: value for key, value in image_headers.items()
            if key.lower() in ('x-media-timestamp', 'x-media-origin')
        }

    def close(self, token, path):
        self.send(BASE + path, 'DELETE', token=token)


class WindowsVault:
    """DPAPI binds encrypted tokens to this Windows user; no plaintext token file."""
    def _crypt(self, value, decrypt=False):
        import ctypes
        from ctypes import wintypes
        class Blob(ctypes.Structure):
            _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte))]
        buffer = ctypes.create_string_buffer(value)
        source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
        result = Blob()
        crypt = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
        if not crypt(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
            raise RuntimeError('Windows credential protection failed')
        try:
            return ctypes.string_at(result.data, result.size)
        finally:
            ctypes.windll.kernel32.LocalFree(result.data)

    def seal(self, value):
        return self._crypt(json.dumps(value).encode())

    def open(self, value):
        return json.loads(self._crypt(value, True))


class ServerVault:
    """Encrypt OAuth tokens with a Railway secret when DPAPI is unavailable."""

    def _fernet(self):
        key = os.environ.get('SPATIALGUARD_TOKEN_KEY', '').strip().encode()
        if not key:
            raise HTTPException(503, 'Ring encrypted token storage is not configured')
        try:
            from cryptography.fernet import Fernet
            return Fernet(key)
        except (ImportError, ValueError):
            raise HTTPException(503, 'Ring encrypted token storage is not configured') from None

    def ready(self):
        self._fernet()

    def seal(self, value):
        return self._fernet().encrypt(json.dumps(value).encode())

    def open(self, value):
        try:
            return json.loads(self._fernet().decrypt(value))
        except Exception:
            raise HTTPException(401, 'Ring access expired or was revoked. Link the account again.') from None
