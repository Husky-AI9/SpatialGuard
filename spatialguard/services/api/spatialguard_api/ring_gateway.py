"""Public surface for the development tunnel. Deliberately has no owner API or assets."""
import html
import json
import threading
import time as clock
from urllib.parse import parse_qs
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, Response
from starlette.concurrency import run_in_threadpool
from .ring_service import RingService
from .store import ROOT


_AUDIT_PATH = ROOT / '.data' / 'spatialguard' / 'ring-gateway-audit.jsonl'
_AUDIT_LOCK = threading.Lock()


def audit(event, **details):
    """Record callback shape and outcome without persisting credentials or payloads."""
    _AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    record = {'at': int(clock.time()), 'event': event, **details}
    with _AUDIT_LOCK, _AUDIT_PATH.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(record, separators=(',', ':')) + '\n')


def page(body):
    return HTMLResponse('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>SpatialGuard · Ring connection</title><style>body{background:#323232;color:#dadada;font:17px system-ui;margin:0;padding:32px}main{max-width:540px;margin:8vh auto}h1{font-size:28px}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;font:inherit;padding:12px;width:100%;border:1px solid #aaa;border-radius:4px}input{background:#444243;color:white}button{margin-top:24px;background:#dadada;color:#242424}small{line-height:1.6}a{color:#fff}</style><main><h1>SpatialGuard</h1>'+body+'</main></html>')


async def read_body(request, limit=65536):
    raw = b''
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > limit: raise HTTPException(413, 'Request too large')
    return raw


def create_gateway(service=None):
    ring = service or RingService()
    app = FastAPI(title='SpatialGuard Ring gateway', docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def headers(request, call_next):
        # The gateway never trusts forwarded authentication or exposes loopback owner routes.
        response = await call_next(request)
        response.headers.update({'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer',
            'X-Content-Type-Options':'nosniff',
            'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"})
        return response

    @app.get('/ring/home')
    def home():
        return page('<h2>Ring connection</h2><p>Manage your cameras in SpatialGuard on your computer or paired Android app.</p><p>This development connection works while your computer and its tunnel are running.</p>')

    @app.get('/ring/link')
    def link(nonce: str = '', time: str = ''):
        if len(nonce) != 43 or not time.isdigit() or len(time) > 15:
            return page('<p>Start connecting SpatialGuard from your private app in Ring. Then return here with the Ring link.</p>')
        return page('<h2>Sign in to connect Ring</h2><p>In your local SpatialGuard app, open Settings → Ring connection and create a sign-in code. Enter it below to authorize this account link.</p>'
            '<form method="post" action="/ring/link"><input type="hidden" name="nonce" value="'+html.escape(nonce, quote=True)+'"><input type="hidden" name="time" value="'+html.escape(time, quote=True)+'">'
            '<label for="code">SpatialGuard sign-in code</label><input id="code" name="code" required minlength="16" maxlength="16" autocomplete="one-time-code"><button>Sign in and connect Ring</button></form><p><small>Use the SpatialGuard code, not your Ring password. The code expires in 10 minutes and works once.</small></p>')

    @app.post('/ring/link')
    async def claim(request: Request):
        origin = request.headers.get('origin', '')
        if origin and origin.split('://')[-1] != request.headers.get('host'):
            raise HTTPException(403, 'Use the Ring linking page')
        data = parse_qs((await read_body(request, 2048)).decode())
        try:
            code, nonce, stamp = (data[k][0] for k in ('code','nonce','time'))
            await run_in_threadpool(ring.claim, code, nonce, stamp)
        except (KeyError, IndexError):
            raise HTTPException(400, 'Missing linking fields') from None
        except HTTPException as e:
            response = page('<h2>Connection not completed</h2><p>'+html.escape(str(e.detail))+'</p><p>Go back to retry, or start a new connection in Ring.</p>')
            response.status_code = e.status_code
            return response
        return page('<h2>Ring account connected</h2><p>Return to SpatialGuard Settings and refresh your Ring devices. Assign each camera to its position on your floor plan.</p>')

    @app.post('/ring/token')
    async def token(request: Request):
        raw = await read_body(request, 8192)
        try:
            if 'application/json' in request.headers.get('content-type', ''):
                data = json.loads(raw)
                code = data.get('code') or data.get('authorization_code')
                incoming_client_id = data.get('client_id')
            else:
                data = parse_qs(raw.decode())
                code = (data.get('code') or data.get('authorization_code') or [None])[0]
                incoming_client_id = (data.get('client_id') or [None])[0]
            audit('token_received', content_type=request.headers.get('content-type', '').split(';', 1)[0],
                  fields=sorted(str(key)[:64] for key in data)[:16],
                  client_id_matches=incoming_client_id == ring.provider.creds.get('client id'))
            if not isinstance(code, str) or not 1 <= len(code) <= 4096: raise ValueError()
        except (ValueError, AttributeError):
            audit('token_rejected', reason='missing_code')
            raise HTTPException(400, 'Missing authorization code') from None
        try:
            await run_in_threadpool(ring.exchange, code)
        except HTTPException as exc:
            audit('token_exchange_failed', status=exc.status_code)
            raise
        except Exception as exc:
            audit('token_exchange_failed', error=type(exc).__name__)
            raise
        audit('token_exchanged')
        return {'ok':True}

    @app.post('/ring/webhook')
    async def webhook(request: Request):
        await run_in_threadpool(ring.webhook, await read_body(request), request.headers.get('x-signature',''))
        return {'ok':True}

    return app
