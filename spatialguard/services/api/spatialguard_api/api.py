import json
import os
import secrets
import sqlite3
import time
import logging
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from .store import (
    DATA,
    Store,
    ROOT,
    account_preferences as read_account_preferences,
    uid,
    digest,
    dump,
    event,
    audit,
    access_log,
    now,
)
from .auth import normalize_email, password_hash, password_matches
from . import models as m
from . import engine as tf
from .engine import LayoutRejected, client, normalize_cameras, publish_layout
from .release import capabilities, require_feature
from .mail import send as send_mail

COOKIE = "spatialguard_session"
DUMMY_PASSWORD_HASH = password_hash(secrets.token_urlsafe(32))
def configured_origin():
    """The one browser origin permitted to hold the hosted owner cookie."""
    return os.environ.get("SPATIALGUARD_ORIGIN", "http://127.0.0.1:8010").rstrip("/")


def create_app(db_path=None, engine=None, ring_service=None):
    store = Store(db_path)
    test_account_email = os.environ.get("SPATIALGUARD_REVIEWER_EMAIL", "").strip()
    test_account_password = os.environ.get("SPATIALGUARD_REVIEWER_PASSWORD", "")
    if test_account_email and test_account_password:
        try:
            test_account_email = normalize_email(test_account_email)
        except ValueError:
            raise RuntimeError("SPATIALGUARD_REVIEWER_EMAIL is invalid") from None
        if len(test_account_password) < 12:
            raise RuntimeError("SPATIALGUARD_REVIEWER_PASSWORD must contain at least 12 characters")
        with store.connect() as db:
            verifier = password_hash(test_account_password)
            reviewer = db.execute("SELECT 1 FROM accounts WHERE id='acct_test_preview'").fetchone()
            conflict = db.execute(
                "SELECT id FROM accounts WHERE email=? COLLATE NOCASE AND id<>'acct_test_preview'",
                (test_account_email,),
            ).fetchone()
            if conflict:
                raise RuntimeError("SPATIALGUARD_REVIEWER_EMAIL is already used by another account")
            if reviewer:
                db.execute(
                    "UPDATE accounts SET email=?,password_hash=?,email_verified=1 WHERE id='acct_test_preview'",
                    (test_account_email, verifier),
                )
            else:
                db.execute(
                    "INSERT INTO accounts(id,email,password_hash,created,email_verified) VALUES (?,?,?,?,1)",
                    ("acct_test_preview", test_account_email, verifier, now()),
                )
    app = FastAPI(title="SpatialGuard", version="0.1.0")
    app.state.store = store
    app.add_middleware(CORSMiddleware, allow_origins=["https://localhost"], allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"], allow_credentials=False)

    @app.exception_handler(RequestValidationError)
    async def sanitized_validation_error(_request: Request, exc: RequestValidationError):
        """Report actionable field errors without reflecting submitted values."""
        errors = []
        for item in exc.errors():
            errors.append({
                "location": [str(part) for part in item.get("loc", ())],
                "message": item.get("msg", "Invalid value"),
                "type": item.get("type", "validation_error"),
            })
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.middleware("http")
    async def security(request, call_next):
        started = time.perf_counter()
        request_id = request.headers.get("x-request-id", "")
        if not request_id or len(request_id) > 80 or not all(ch.isalnum() or ch in "-_" for ch in request_id):
            request_id = secrets.token_hex(12)
        allowed_hosts = {"127.0.0.1:8010", "localhost:8010", "testserver"}
        configured_hosts = os.environ.get("SPATIALGUARD_ALLOWED_HOSTS", "")
        allowed_hosts.update(host.strip() for host in configured_hosts.split(",") if host.strip())
        # Railway's health probe may use an internal host before a public
        # domain has been assigned. Keep the probe reachable while preserving
        # the local host guard for application routes.
        if request.url.path != "/health" and request.headers.get("host") not in allowed_hosts:
            return Response(status_code=400)
        if (os.environ.get("SPATIALGUARD_MAINTENANCE_MODE", "").lower() in {"1", "true", "yes", "on"}
                and request.url.path not in {"/health", "/status", "/privacy", "/terms", "/support"}):
            return Response(
                content=json.dumps({"detail": "SpatialGuard is temporarily unavailable for maintenance. Retry shortly."}),
                status_code=503,
                media_type="application/json",
                headers={"Retry-After": "300", "X-Request-ID": request_id},
            )
        response = await call_next(request)
        route = request.scope.get("route")
        route_name = getattr(route, "path", "unmatched")
        logging.getLogger("spatialguard.request").info(json.dumps({
            "event": "request.complete",
            "method": request.method,
            "route": route_name,
            "status": response.status_code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            "request_id": request_id,
        }, separators=(",", ":")))
        response.headers["X-Request-ID"] = request_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        if configured_origin().startswith("https://"):
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"
        return response

    def local_browser(request):
        if any(k in request.headers for k in ('forwarded', 'x-forwarded-for', 'cf-connecting-ip')):
            raise HTTPException(403, "Owner sessions are not available through a tunnel")
        if request.client.host not in {"127.0.0.1", "::1", "testclient"} or request.headers.get("x-spatialguard-local") != "1":
            raise HTTPException(403, "Local owner browser required")
        origin = request.headers.get("origin")
        if origin and origin != configured_origin():
            raise HTTPException(403, "Use the local owner browser")
        if request.headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "none"}:
            raise HTTPException(403, "Same-origin browser required")

    def hosted_browser(request):
        """Require the configured HTTPS site for cookie-authenticated writes."""
        origin = configured_origin()
        if not origin.startswith("https://"):
            raise HTTPException(403, "Hosted browser sessions are not configured")
        if request.headers.get("origin") != origin:
            raise HTTPException(403, "Use the configured SpatialGuard site")
        if request.headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "none"}:
            raise HTTPException(403, "Same-origin browser required")

    def cookie_browser(request):
        if (configured_origin().startswith("http://") and
                request.client.host in {"127.0.0.1", "::1", "testclient"}):
            local_browser(request)
        else:
            hosted_browser(request)

    def principal(request: Request):
        bearer = request.headers.get("authorization", "")
        token = bearer[7:] if bearer.startswith("Bearer ") else request.cookies.get(COOKIE, "")
        if not bearer and request.method not in {"GET", "HEAD"}:
            cookie_browser(request)
        with store.connect() as db:
            row = db.execute("SELECT * FROM sessions WHERE digest=? AND expires>?", (digest(token), time.time())).fetchone()
        if not row:
            raise HTTPException(401, "Sign in or pair this device")
        reviewer_key = os.environ.get("SPATIALGUARD_REVIEWER_KEY", "")
        reviewer_bypass = bool(reviewer_key) and secrets.compare_digest(
            request.headers.get("x-spatialguard-reviewer-key", ""), reviewer_key,
        )
        if (row["owner"] == "acct_test_preview" and request.method not in {"GET", "HEAD"}
                and os.environ.get("SPATIALGUARD_DEMO_READ_ONLY", "").lower() in {"1", "true", "yes"}
                and not reviewer_bypass):
            raise HTTPException(403, "This replay workspace is read-only")
        return dict(row)

    def owned(db, site_id, p):
        row = db.execute("SELECT data FROM sites WHERE id=? AND owner=?", (site_id, p["owner"])).fetchone()
        if not row:
            raise HTTPException(404, "Site not found")
        return json.loads(row[0])

    def session_data(row, db=None):
        if db is None:
            with store.connect() as lookup:
                account = lookup.execute("SELECT email FROM accounts WHERE id=?", (row["owner"],)).fetchone()
        else:
            account = db.execute("SELECT email FROM accounts WHERE id=?", (row["owner"],)).fetchone()
        return m.Session(
            id=row["id"], name=row["name"], kind=row["kind"],
            expires_at=row["expires"], email=account["email"] if account else None,
        )

    def issue(db, owner, kind, name):
        token, sid = secrets.token_urlsafe(32), uid("session")
        expires = time.time() + (86400 * 30 if kind == "android" else 28800)
        db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)", (sid, owner, digest(token), name, kind, expires))
        account = db.execute("SELECT email FROM accounts WHERE id=?", (owner,)).fetchone()
        return m.SessionToken(token=token, session=m.Session(
            id=sid, name=name, kind=kind, expires_at=expires,
            email=account["email"] if account else None,
        ))

    def set_browser_cookie(response, token):
        secure = configured_origin().startswith("https://")
        response.set_cookie(
            COOKIE, token, httponly=True, samesite="lax" if secure else "strict",
            secure=secure, max_age=28800, path="/",
        )

    def auth_kind(request):
        if request.headers.get("x-spatialguard-client") == "android":
            return "android"
        cookie_browser(request)
        return "browser"

    def throttle(db, key, limit):
        row = db.execute("SELECT * FROM attempts WHERE peer=?", (key,)).fetchone()
        recent = row and row["starts"] > time.time() - 60
        count = row["count"] + 1 if recent else 1
        start = row["starts"] if recent else time.time()
        db.execute("INSERT OR REPLACE INTO attempts VALUES (?,?,?)", (key, start, count))
        if count > limit:
            raise HTTPException(429, "Too many attempts. Wait one minute and try again.")

    def legacy_owner(db, request):
        token = request.cookies.get(COOKIE, "")
        if not token:
            return None
        row = db.execute(
            "SELECT owner FROM sessions WHERE digest=? AND expires>?",
            (digest(token), time.time()),
        ).fetchone()
        return row["owner"] if row and row["owner"] in {"local_owner", "hosted_owner"} else None

    def claim_legacy_workspace(db, old_owner, new_owner):
        """Move the authenticated preview workspace to its new email account."""
        for table in ("sites", "plans", "audit", "ring_accounts", "ring_streams", "ring_alerts", "timelapse_projects"):
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                db.execute(f"UPDATE {table} SET owner=? WHERE owner=?", (new_owner, old_owner))
        old_privacy = db.execute(
            "SELECT 1 FROM account_preferences WHERE owner=?", (old_owner,)
        ).fetchone()
        if old_privacy:
            db.execute("DELETE FROM account_preferences WHERE owner=?", (new_owner,))
            db.execute("UPDATE account_preferences SET owner=? WHERE owner=?", (new_owner, old_owner))
        for table in ("ring_ops_preferences", "ring_camera_wall"):
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                db.execute(f"UPDATE {table} SET owner=? WHERE owner=?", (new_owner, old_owner))
        old_key, new_key = "active_site:" + old_owner, "active_site:" + new_owner
        preference = db.execute("SELECT value FROM settings WHERE key=?", (old_key,)).fetchone()
        if preference:
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (new_key, preference["value"]))
            db.execute("DELETE FROM settings WHERE key=?", (old_key,))
        db.execute("DELETE FROM pairing WHERE owner=?", (old_owner,))
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ring_codes'").fetchone():
            db.execute("DELETE FROM ring_codes WHERE owner=?", (old_owner,))
        # Shared-code sessions must not survive the move to an individual account.
        db.execute("DELETE FROM sessions WHERE owner=?", (old_owner,))

    def auth_result(result, kind, response):
        if kind == "browser":
            set_browser_cookie(response, result.token)
            return m.AuthSession(session=result.session)
        return m.AuthSession(session=result.session, token=result.token)

    @app.get("/health")
    def health():
        try:
            with store.connect() as db:
                db.execute("SELECT 1").fetchone()
                queued = db.execute(
                    "SELECT count(*) FROM ring_inbox WHERE state IN ('queued','running')"
                ).fetchone()[0] if db.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ring_inbox'"
                ).fetchone() else 0
                failed = db.execute(
                    "SELECT count(*) FROM ring_inbox WHERE state='failed'"
                ).fetchone()[0] if db.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ring_inbox'"
                ).fetchone() else 0
            return {"status": "ok", "application": "spatialguard", "database": "available",
                    "queue": {"pending": queued, "failed": failed}}
        except sqlite3.Error:
            return Response(
                content=json.dumps({"status": "unavailable", "application": "spatialguard", "database": "unavailable"}),
                status_code=503,
                media_type="application/json",
            )

    @app.get("/status")
    def public_status():
        flags = capabilities()
        return {
            "status": "operational",
            "application": "SpatialGuard",
            "version": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "development")[:12],
            "release_profile": flags["profile"],
            "evidence_modes": ["live", "replay"] if flags["synthetic_replay"] else ["live"],
            "database": "available",
            "ring_adapter": "configured" if os.environ.get("RING_CLIENT_ID") else "not_configured",
            "twinforge": "configured" if os.environ.get("SPATIALGUARD_TWINFORGE_URL") else "local_default",
        }

    @app.get("/v1/product-capabilities", response_model=m.ProductCapabilities)
    def product_capabilities():
        return capabilities()

    @app.post("/v1/auth/signup", response_model=m.AuthSession, status_code=201)
    def signup(body: m.AccountCredentials, request: Request, response: Response):
        kind = auth_kind(request)
        email = normalize_email(body.email)
        owner = uid("acct")
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            throttle(db, "signup:" + request.client.host, 8)
        verifier = password_hash(body.password)
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old_owner = legacy_owner(db, request)
            try:
                db.execute("INSERT INTO accounts(id,email,password_hash,created,email_verified) VALUES (?,?,?,?,0)", (owner, email, verifier, now()))
            except sqlite3.IntegrityError:
                raise HTTPException(409, "An account with this email already exists") from None
            db.execute("INSERT OR IGNORE INTO account_preferences(owner) VALUES (?)", (owner,))
            if old_owner:
                claim_legacy_workspace(db, old_owner, owner)
            result = issue(db, owner, kind, "Android app" if kind == "android" else "Web browser")
            verification_token = create_auth_token(db, owner, "email_verification", 86400)
            audit(db, owner, "account.created", owner)
        try:
            send_mail(
                "Verify your SpatialGuard email", email,
                "Verify this address within 24 hours:\n\n" + configured_origin() + "/verify-email?token=" + verification_token,
            )
        except Exception:
            pass
        return auth_result(result, kind, response)

    @app.post("/v1/auth/signin", response_model=m.AuthSession)
    def signin(body: m.AccountCredentials, request: Request, response: Response):
        kind = auth_kind(request)
        email = normalize_email(body.email)
        attempt_key = "signin:" + request.client.host + ":" + digest(email)[:16]
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            throttle(db, "signin-ip:" + request.client.host, 30)
            throttle(db, attempt_key, 10)
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            account = db.execute("SELECT * FROM accounts WHERE email=? COLLATE NOCASE", (email,)).fetchone()
            valid_password = password_matches(
                body.password, account["password_hash"] if account else DUMMY_PASSWORD_HASH,
            )
            if not account or not valid_password:
                time.sleep(0.15)
                raise HTTPException(401, "Email or password is incorrect")
            db.execute("DELETE FROM attempts WHERE peer=?", (attempt_key,))
            db.execute("DELETE FROM sessions WHERE expires<=?", (time.time(),))
            previous_token = request.cookies.get(COOKIE, "")
            if previous_token:
                db.execute("DELETE FROM sessions WHERE digest=?", (digest(previous_token),))
            result = issue(db, account["id"], kind, "Android app" if kind == "android" else "Web browser")
            audit(db, account["id"], "account.signed_in", result.session.id)
        return auth_result(result, kind, response)

    def create_auth_token(db, owner, purpose, ttl=1800):
        token = secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO auth_tokens(digest,owner,purpose,expires,created_at) VALUES (?,?,?,?,?)",
            (digest(token), owner, purpose, time.time() + ttl, now()),
        )
        return token

    @app.get("/v1/account/verification")
    def verification_status(p=Depends(principal)):
        with store.connect() as db:
            row = db.execute("SELECT email,email_verified FROM accounts WHERE id=?", (p["owner"],)).fetchone()
        return {"email": row["email"] if row else None, "verified": bool(row and row["email_verified"])}

    @app.post("/v1/account/verification/request", response_model=m.AuthMessage)
    def request_verification(p=Depends(principal)):
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            account = db.execute("SELECT email,email_verified FROM accounts WHERE id=?", (p["owner"],)).fetchone()
            if not account or account["email_verified"]:
                return {"message": "This email is already verified."}
            db.execute("DELETE FROM auth_tokens WHERE owner=? AND purpose='email_verification'", (p["owner"],))
            token = create_auth_token(db, p["owner"], "email_verification", 86400)
            audit(db, p["owner"], "email_verification.requested", "account")
        try:
            delivered = send_mail("Verify your SpatialGuard email", account["email"],
                "Verify this address within 24 hours:\n\n" + configured_origin() + "/verify-email?token=" + token)
        except Exception:
            delivered = False
        return {"message": "Verification email sent." if delivered else "Email delivery is not configured yet. Try again later."}

    @app.post("/v1/auth/email/verify", response_model=m.AuthMessage)
    def verify_email(body: m.TokenConfirmation):
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM auth_tokens WHERE digest=? AND purpose='email_verification' AND used_at IS NULL AND expires>?",
                (digest(body.token), time.time()),
            ).fetchone()
            if not row:
                raise HTTPException(400, "This verification link is invalid or expired")
            db.execute("UPDATE accounts SET email_verified=1 WHERE id=?", (row["owner"],))
            db.execute("UPDATE auth_tokens SET used_at=? WHERE digest=?", (now(), row["digest"]))
            audit(db, row["owner"], "email.verified", "account")
        return {"message": "Email verified. You can return to SpatialGuard."}

    @app.post("/v1/auth/password/request", response_model=m.AuthMessage)
    def request_password_reset(body: m.PasswordRequest, request: Request):
        email = normalize_email(body.email)
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            throttle(db, "reset:" + request.client.host + ":" + digest(email)[:16], 5)
            account = db.execute("SELECT id FROM accounts WHERE email=? COLLATE NOCASE", (email,)).fetchone()
            if account:
                db.execute("DELETE FROM auth_tokens WHERE owner=? AND purpose='password_reset'", (account["id"],))
                token = create_auth_token(db, account["id"], "password_reset")
                audit(db, account["id"], "password_reset.requested", "account")
                reset_url = configured_origin() + "/reset-password?token=" + token
                try:
                    delivered = send_mail(
                        "Reset your SpatialGuard password", email,
                        "Use this single-use link within 30 minutes:\n\n" + reset_url,
                    )
                except Exception:
                    delivered = False
                db.execute(
                    "INSERT INTO notification_history(owner,category,channel,state,detail,at) VALUES (?,?,?,?,?,?)",
                    (account["id"], "security", "email", "sent" if delivered else "failed", "Password reset", now()),
                )
        return {"message": "If that email has an account, password reset instructions have been sent."}

    @app.post("/v1/auth/password/reset", response_model=m.AuthMessage)
    def reset_password(body: m.PasswordReset, request: Request):
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            throttle(db, "reset-use:" + request.client.host, 10)
            row = db.execute(
                "SELECT * FROM auth_tokens WHERE digest=? AND purpose='password_reset' AND used_at IS NULL AND expires>?",
                (digest(body.token), time.time()),
            ).fetchone()
            if not row:
                raise HTTPException(400, "This reset link is invalid or expired")
            db.execute("UPDATE accounts SET password_hash=? WHERE id=?", (password_hash(body.password), row["owner"]))
            db.execute("UPDATE auth_tokens SET used_at=? WHERE digest=?", (now(), row["digest"]))
            db.execute("DELETE FROM sessions WHERE owner=?", (row["owner"],))
            audit(db, row["owner"], "password_reset.completed", "account")
        return {"message": "Password changed. Sign in with the new password."}

    @app.post("/v1/auth/signout", status_code=204)
    def signout(response: Response, p=Depends(principal)):
        with store.connect() as db:
            db.execute("DELETE FROM sessions WHERE id=? AND owner=?", (p["id"], p["owner"]))
            audit(db, p["owner"], "account.signed_out", p["id"])
        response.delete_cookie(COOKIE, path="/")

    @app.post("/v1/local-session", response_model=m.Session)
    def browser_session(request: Request, response: Response):
        local_browser(request)
        with store.connect() as db:
            row = db.execute("SELECT * FROM sessions WHERE digest=? AND expires>? AND kind='browser'", (digest(request.cookies.get(COOKIE, "")), time.time())).fetchone()
            if row:
                return session_data(row)
            db.execute("DELETE FROM sessions WHERE expires<=?", (time.time(),))
            # One owner on one machine does not need a hundred browser sessions.
            db.execute("""DELETE FROM sessions WHERE kind='browser' AND owner='local_owner'
                AND id NOT IN (SELECT id FROM sessions WHERE kind='browser' AND owner='local_owner'
                ORDER BY expires DESC LIMIT 4)""")
            result = issue(db, "local_owner", "browser", "Local owner browser")
        response.set_cookie(COOKIE, result.token, httponly=True, samesite="strict", max_age=28800)
        return result.session

    @app.get("/v1/me", response_model=m.Session)
    def me(p=Depends(principal)):
        return session_data(p)

    @app.post("/v1/account/password", response_model=m.AuthMessage)
    def change_password(body: m.PasswordChange, p=Depends(principal)):
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            account = db.execute("SELECT * FROM accounts WHERE id=?", (p["owner"],)).fetchone()
            if not account or not password_matches(body.current_password, account["password_hash"]):
                raise HTTPException(401, "Current password is incorrect")
            db.execute("UPDATE accounts SET password_hash=? WHERE id=?", (password_hash(body.new_password), p["owner"]))
            db.execute("DELETE FROM sessions WHERE owner=? AND id<>?", (p["owner"], p["id"]))
            audit(db, p["owner"], "password.changed", "account")
            email = account["email"]
        try:
            delivered = send_mail("Your SpatialGuard password changed", email,
                "Your SpatialGuard password was changed. If this was not you, reset it and contact support.")
        except Exception:
            delivered = False
        with store.connect() as db:
            db.execute("INSERT INTO notification_history(owner,category,channel,state,detail,at) VALUES (?,?,?,?,?,?)",
                       (p["owner"], "security", "email", "sent" if delivered else "failed", "Password changed", now()))
        return {"message": "Password changed. Other devices were signed out."}

    @app.post("/v1/sessions/revoke-all", status_code=204)
    def revoke_all_sessions(p=Depends(principal)):
        with store.connect() as db:
            db.execute("DELETE FROM sessions WHERE owner=? AND id<>?", (p["owner"], p["id"]))
            audit(db, p["owner"], "sessions.revoked_all", "account")

    @app.get("/v1/account/security-activity")
    def security_activity(p=Depends(principal)):
        with store.connect() as db:
            rows = db.execute(
                "SELECT action,at FROM audit WHERE owner=? AND (action LIKE 'account.%' OR action LIKE 'password_%' OR action LIKE 'session%') ORDER BY id DESC LIMIT 50",
                (p["owner"],),
            ).fetchall()
            return [{"action": row["action"], "at": row["at"]} for row in rows]

    @app.get("/v1/account/access-log", response_model=list[m.AccessRecord])
    def account_access_log(p=Depends(principal)):
        with store.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT id,actor,action,device,purpose,result,at FROM data_access_log WHERE owner=? ORDER BY id DESC LIMIT 200",
                (p["owner"],),
            )]

    @app.get("/v1/account/notifications", response_model=m.NotificationPreferences)
    def notification_preferences(p=Depends(principal)):
        with store.connect() as db:
            row = db.execute("SELECT * FROM notification_preferences WHERE owner=?", (p["owner"],)).fetchone()
            if not row:
                db.execute("INSERT INTO notification_preferences(owner) VALUES (?)", (p["owner"],))
                row = db.execute("SELECT * FROM notification_preferences WHERE owner=?", (p["owner"],)).fetchone()
            return {key: bool(row[key]) for key in ("incident_email", "operational_email", "weekly_summary", "marketing")}

    @app.put("/v1/account/notifications", response_model=m.NotificationPreferences)
    def update_notification_preferences(body: m.NotificationPreferences, p=Depends(principal)):
        values = body.model_dump()
        with store.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO notification_preferences VALUES (?,?,?,?,?)",
                (p["owner"], *(int(values[key]) for key in ("incident_email", "operational_email", "weekly_summary", "marketing"))),
            )
            audit(db, p["owner"], "notifications.preferences_changed", "account")
        return body

    @app.get("/v1/account/notification-history")
    def notification_history(p=Depends(principal)):
        with store.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT category,channel,state,detail,at FROM notification_history WHERE owner=? ORDER BY id DESC LIMIT 100",
                (p["owner"],),
            )]

    @app.get("/v1/account/export")
    def export_account(p=Depends(principal)):
        with store.connect() as db:
            account = db.execute("SELECT email,created FROM accounts WHERE id=?", (p["owner"],)).fetchone()
            preferences = read_account_preferences(db, p["owner"])
            sites = [json.loads(row["data"]) for row in db.execute("SELECT data FROM sites WHERE owner=?", (p["owner"],))]
            site_ids = [site["id"] for site in sites]
            incidents = []
            for site_id in site_ids:
                incidents.extend(json.loads(row["data"]) for row in db.execute("SELECT data FROM incidents WHERE site_id=?", (site_id,)))
            access = [dict(row) for row in db.execute(
                "SELECT actor,action,device,purpose,result,at FROM data_access_log WHERE owner=? ORDER BY id", (p["owner"],)
            )]
            audit(db, p["owner"], "account.exported", "account")
        return {
            "format": "spatialguard-account-export-v1", "exported_at": now(),
            "account": dict(account) if account else {"workspace": "local"},
            "preferences": preferences,
            "sites": sites, "incidents": incidents, "data_access": access,
        }

    @app.get("/v1/account/preferences", response_model=m.AccountPreferences)
    def account_preferences(p=Depends(principal)):
        with store.connect() as db:
            return read_account_preferences(db, p["owner"])

    @app.patch("/v1/account/preferences", response_model=m.AccountPreferences)
    def update_account_preferences(body: m.AccountPreferences, p=Depends(principal)):
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = read_account_preferences(db, p["owner"])
            consent_changed = (
                existing["ring_data_consent"] != body.ring_data_consent
                or existing["classification_consent"] != body.classification_consent
            )
            # Snapshot classification necessarily uses Ring event data, so it
            # cannot remain enabled after the broader permission is withdrawn.
            classification_consent = bool(
                body.classification_consent and body.ring_data_consent
            )
            consent_at = now() if consent_changed else existing["consent_updated_at"]
            db.execute(
                """INSERT OR REPLACE INTO account_preferences(
                    owner,onboarding_completed,ring_data_consent,classification_consent,
                    incident_retention_days,audit_retention_days,consent_updated_at
                ) VALUES (?,?,?,?,?,?,?)""",
                (
                    p["owner"], int(body.onboarding_completed), int(body.ring_data_consent),
                    int(classification_consent), body.incident_retention_days,
                    body.audit_retention_days, consent_at,
                ),
            )
            automatic_classification = bool(
                body.ring_data_consent and classification_consent and capabilities()["classification"]
            )
            for row in db.execute("SELECT id,data FROM sites WHERE owner=?", (p["owner"],)):
                site = json.loads(row["data"])
                if site.get("monitoring", {}).get("classification_enabled", False) != automatic_classification:
                    site["monitoring"]["classification_enabled"] = automatic_classification
                    site["monitoring_version"] = site.get("monitoring_version", 0) + 1
                    db.execute("UPDATE sites SET data=? WHERE id=?", (dump(site), row["id"]))
                    event(db, row["id"], "monitoring.changed", row["id"])
            audit(db, p["owner"], "privacy.preferences_changed", p["owner"])
            return read_account_preferences(db, p["owner"], create=False)

    @app.get("/v1/sessions", response_model=list[m.Session])
    def sessions(p=Depends(principal)):
        with store.connect() as db:
            return [session_data(r, db) for r in db.execute("SELECT * FROM sessions WHERE owner=? AND expires>?", (p["owner"], time.time()))]

    @app.post("/v1/pairing", response_model=m.PairCode)
    def pairing(p=Depends(principal)):
        if p["kind"] != "browser":
            raise HTTPException(403, "Create a code in the owner browser")
        code = secrets.token_hex(6).upper()
        expires = time.time()+180
        with store.connect() as db:
            db.execute("DELETE FROM pairing WHERE owner=?", (p["owner"],))
            db.execute("INSERT INTO pairing VALUES (?,?,?)", (digest(code), p["owner"], expires))
            audit(db, p["owner"], "pairing.created", p["id"])
        return m.PairCode(code=code, expires_at=expires)

    @app.post("/v1/pairing/redeem", response_model=m.SessionToken)
    def redeem(body: m.PairInput, request: Request):
        peer = request.client.host
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM attempts WHERE peer=?", (peer,)).fetchone()
            count = row["count"]+1 if row and row["starts"] > time.time()-60 else 1
            start = row["starts"] if count > 1 else time.time()
            db.execute("INSERT OR REPLACE INTO attempts VALUES (?,?,?)", (peer, start, count))
        if count > 10:
            raise HTTPException(429, "Too many pairing attempts. Wait one minute.")
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM pairing WHERE digest=? AND expires>?", (digest(body.code.strip().upper()), time.time())).fetchone()
            if not row:
                raise HTTPException(401, "Pairing code is invalid or expired")
            db.execute("DELETE FROM pairing WHERE digest=?", (row["digest"],))
            result = issue(db, row["owner"], "android", body.name)
            audit(db, row["owner"], "device.paired", result.session.id)
            return result

    @app.post("/v1/sessions/renew", response_model=m.SessionToken)
    def renew(p=Depends(principal)):
        if p["kind"] != "android":
            raise HTTPException(403, "Android renewal only")
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("DELETE FROM sessions WHERE id=?", (p["id"],)).rowcount:
                raise HTTPException(401, "Session already renewed or revoked")
            return issue(db, p["owner"], p["kind"], p["name"])

    @app.delete("/v1/sessions/{session_id}", status_code=204)
    def revoke(session_id: str, p=Depends(principal)):
        with store.connect() as db:
            if not db.execute("DELETE FROM sessions WHERE id=? AND owner=?", (session_id, p["owner"])).rowcount:
                raise HTTPException(404, "Session not found")
            audit(db, p["owner"], "session.revoked", session_id)

    @app.delete("/v1/account", response_model=m.DeletionReceipt)
    def delete_account(body: m.AccountDeletion, response: Response, p=Depends(principal)):
        """Permanently remove an email account and all owner-scoped records."""
        requested_at = now()
        receipt_reference = "delete_" + secrets.token_hex(8)
        categories = ["account", "sessions", "places", "incidents", "evidence", "Ring connection", "time-lapse files"]
        with store.connect() as db:
            account = db.execute("SELECT * FROM accounts WHERE id=?", (p["owner"],)).fetchone()
            if not account:
                raise HTTPException(409, "Local preview workspaces do not have an account to delete")
            if not password_matches(body.password, account["password_hash"]):
                raise HTTPException(401, "Password is incorrect")
            site_ids = [row["id"] for row in db.execute(
                "SELECT id FROM sites WHERE owner=?", (p["owner"],)
            )]
            engine_sites = set(site_ids)
            engine_sites.update(row["engine_site"] for row in db.execute(
                "SELECT engine_site FROM plans WHERE owner=?", (p["owner"],)
            ))
            ring_accounts = [row["account"] for row in db.execute(
                "SELECT account FROM ring_accounts WHERE owner=?", (p["owner"],)
            )]
            projects = [row["id"] for row in db.execute(
                "SELECT id FROM timelapse_projects WHERE owner=?", (p["owner"],)
            )]
            frame_paths = [row["path"] for row in db.execute(
                "SELECT f.path FROM timelapse_frames f JOIN timelapse_projects p ON p.id=f.project WHERE p.owner=?",
                (p["owner"],),
            )]

        # Revoke the provider grant while credentials still exist. If Ring is
        # unavailable, keep the account so the owner can retry instead of
        # silently leaving a connected integration behind.
        try:
            app.state.ring.disconnect(p["owner"])
        except Exception:
            raise HTTPException(
                503,
                "Ring could not be disconnected. Retry, or remove SpatialGuard in Ring before deleting the account.",
            ) from None

        # The provider grant is now gone. Remove the matching local provider
        # material immediately so a later TwinForge outage cannot leave an
        # ownerless token row or time-lapse file behind.
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for account_id in ring_accounts:
                for table in ("ring_devices", "ring_inbox", "ring_health"):
                    db.execute(f"DELETE FROM {table} WHERE account=?", (account_id,))
                db.execute("DELETE FROM ring_streams WHERE account=?", (account_id,))
                db.execute("DELETE FROM ring_accounts WHERE account=?", (account_id,))
            for project_id in projects:
                db.execute("DELETE FROM timelapse_frames WHERE project=?", (project_id,))
            db.execute("DELETE FROM timelapse_projects WHERE owner=?", (p["owner"],))
            for table in ("ring_codes", "ring_streams", "ring_alerts", "ring_ops_preferences", "ring_camera_wall"):
                db.execute(f"DELETE FROM {table} WHERE owner=?", (p["owner"],))
        data_root = DATA.resolve()
        for value in frame_paths:
            try:
                path = Path(value).resolve()
                if path.is_relative_to(data_root):
                    path.unlink(missing_ok=True)
            except OSError:
                pass

        # Remove one TwinForge place at a time and retire its local reference
        # immediately. A retry therefore continues safely after a partial
        # upstream outage instead of getting stuck on a site already removed.
        for engine_site in engine_sites:
            engine_call(tf.delete_site, engine_site)
            with store.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                for table in ("incidents", "evidence", "runs", "events"):
                    db.execute(f"DELETE FROM {table} WHERE site_id=?", (engine_site,))
                db.execute("DELETE FROM sites WHERE id=? AND owner=?", (engine_site, p["owner"]))
                db.execute("DELETE FROM plans WHERE engine_site=? AND owner=?", (engine_site, p["owner"]))
                db.execute("DELETE FROM settings WHERE key=? AND value=?", ("active_site:" + p["owner"], engine_site))
                db.execute("DELETE FROM settings WHERE key='engine_site' AND value=?", (engine_site,))

        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for site_id in site_ids:
                for table in ("incidents", "evidence", "runs", "events"):
                    db.execute(f"DELETE FROM {table} WHERE site_id=?", (site_id,))
            for table in (
                "sites", "plans", "sessions", "pairing", "audit", "account_preferences",
                "auth_tokens", "data_access_log", "notification_preferences", "notification_history",
            ):
                db.execute(f"DELETE FROM {table} WHERE owner=?", (p["owner"],))
            db.execute("DELETE FROM settings WHERE key=?", ("active_site:" + p["owner"],))
            db.execute("DELETE FROM accounts WHERE id=?", (p["owner"],))
            completed_at = now()
            db.execute(
                "INSERT INTO deletion_receipts VALUES (?,?,?,?,?)",
                (receipt_reference, requested_at, completed_at, dump(categories), "Ring disconnected and local processors completed"),
            )

        response.delete_cookie(COOKIE, path="/")
        return m.DeletionReceipt(
            reference=receipt_reference, requested_at=requested_at,
            completed_at=completed_at, categories=categories,
            downstream="Ring disconnected and local processors completed",
        )

    @app.get("/v1/deletion-receipts/{reference}", response_model=m.DeletionReceipt)
    def deletion_receipt(reference: str):
        if not reference.startswith("delete_") or len(reference) != 23:
            raise HTTPException(404, "Deletion receipt not found")
        with store.connect() as db:
            row = db.execute("SELECT * FROM deletion_receipts WHERE reference=?", (reference,)).fetchone()
        if not row:
            raise HTTPException(404, "Deletion receipt not found")
        return {**dict(row), "categories": json.loads(row["categories"])}

    @app.get("/v1/sites", response_model=list[m.Site])
    def sites(p=Depends(principal)):
        with store.connect() as db:
            preferences = read_account_preferences(db, p["owner"])
            automatic_classification = bool(
                preferences["ring_data_consent"] and preferences["classification_consent"]
                and capabilities()["classification"]
            )
            result = []
            for row in db.execute("SELECT id,data FROM sites WHERE owner=?", (p["owner"],)):
                site = json.loads(row["data"])
                if site.get("monitoring", {}).get("classification_enabled", False) != automatic_classification:
                    site["monitoring"]["classification_enabled"] = automatic_classification
                    site["monitoring_version"] = site.get("monitoring_version", 0) + 1
                    db.execute("UPDATE sites SET data=? WHERE id=?", (dump(site), row["id"]))
                result.append(site)
            return result

    def active_key(p):
        return "active_site:" + p["owner"]

    @app.get("/v1/preferences", response_model=m.Preferences)
    def preferences(p=Depends(principal)):
        with store.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (active_key(p),)).fetchone()
            # A place the owner no longer has is not a usable choice.
            if row and db.execute("SELECT 1 FROM sites WHERE id=? AND owner=?", (row[0], p["owner"])).fetchone():
                return m.Preferences(active_site_id=row[0])
        return m.Preferences()

    @app.put("/v1/preferences", response_model=m.Preferences)
    def set_preferences(body: m.Preferences, p=Depends(principal)):
        with store.connect() as db:
            if body.active_site_id is None:
                db.execute("DELETE FROM settings WHERE key=?", (active_key(p),))
                return m.Preferences()
            owned(db, body.active_site_id, p)
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (active_key(p), body.active_site_id))
        return body

    @app.post("/v1/sample-site", response_model=m.Site, status_code=201)
    def create_sample_site(p=Depends(principal)):
        """Add the built-in synthetic demo place on request."""
        try:
            site = tf.sample_site(engine or client(), store, p["owner"])
        except Exception:
            site = tf.bundled_sample_site(store, p["owner"])
        with store.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (active_key(p), site["id"]))
            audit(db, p["owner"], "sample.loaded", site["id"])
        return site

    @app.patch("/v1/sites/{site_id}/monitoring", response_model=m.Site)
    def monitoring(site_id: str, body: m.Monitoring, p=Depends(principal)):
        with store.connect() as db:
            site = owned(db, site_id, p)
            preferences = read_account_preferences(db, p["owner"])
            allowed = {c["id"] for c in site["layout"]["cameras"]}
            if len(set(body.camera_ids)) != len(body.camera_ids) or not set(body.camera_ids) <= allowed:
                raise HTTPException(422, "Select cameras in this site")
            site["monitoring"] = body.model_dump()
            site["monitoring"]["classification_enabled"] = bool(
                preferences["ring_data_consent"] and preferences["classification_consent"]
                and capabilities()["classification"]
            )
            site["monitoring_version"] = site.get("monitoring_version", 0) + 1
            db.execute("UPDATE sites SET data=? WHERE id=?", (dump(site), site_id))
            event(db, site_id, "monitoring.changed", site_id)
            audit(db, p["owner"], "monitoring.changed", site_id)
            return site

    @app.delete("/v1/sites/{site_id}", status_code=204)
    def remove_site(site_id: str, p=Depends(principal)):
        """Remove a place and everything recorded against it, drawing included."""
        with store.connect() as db:
            site = owned(db, site_id, p)
            bundled = db.execute(
                "SELECT 1 FROM settings WHERE key=?", ("demo_bundle:" + site_id,)
            ).fetchone()
        # Delete upstream first: a local row is recoverable, an orphaned drawing is not.
        # The bundled demo is already a local immutable export and has no upstream row.
        if not bundled:
            engine_call(tf.delete_site, site_id)
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for table in ("incidents", "evidence", "runs", "events"):
                db.execute(f"DELETE FROM {table} WHERE site_id=?", (site_id,))
            db.execute("DELETE FROM sites WHERE id=? AND owner=?", (site_id, p["owner"]))
            db.execute("DELETE FROM settings WHERE key=? AND value=?", (active_key(p), site_id))
            db.execute("DELETE FROM settings WHERE key=?", ("demo_bundle:" + site_id,))
            # The sample can be loaded again from scratch.
            db.execute("DELETE FROM settings WHERE key='engine_site' AND value=?", (site_id,))
            audit(db, p["owner"], "site.removed", site_id)

    @app.get("/v1/sites/{site_id}/cameras", response_model=list[m.CameraStatus])
    def cameras(site_id: str, p=Depends(principal)):
        with store.connect() as db:
            site = owned(db, site_id, p)
            incidents = [json.loads(r[0]) for r in db.execute("SELECT data FROM incidents WHERE site_id=?", (site_id,))]
            mapped = {r[0] for r in db.execute("SELECT d.camera FROM ring_devices d JOIN ring_accounts a ON a.account=d.account WHERE d.site=? AND a.owner=? AND a.state='connected'", (site_id,p['owner']))}
        return [m.CameraStatus(id=c["id"], name=c["name"], selected=c["id"] in site["monitoring"]["camera_ids"],
            state='live_connected' if c['id'] in mapped else 'replay_only',
            calibration='Not calibrated; Ring event positions are unknown' if c['id'] in mapped else 'Synthetic coordinates; no real-camera calibration',
            last_observed_at=max((o["observed_at"] for i in incidents for o in i["observations"] if o["source_id"]==c["id"] and (o["location"]["kind"]!="unknown" or i.get('evidence_mode')=='live')), default=None)) for c in site["layout"]["cameras"]]

    OWNER_PLACED = ("Placed by the site owner in SpatialGuard. Synthetic coordinates; "
                    "no measured camera calibration.")
    OWNER_EDITED = ("Placement or view edited by the site owner in SpatialGuard. Synthetic coordinates; "
                    "no measured camera calibration.")

    def geometry_edit(site_id, p, change):
        """Apply a layout change, publish it through TwinForge, and pin the new revision.

        Published revisions are immutable, so every camera edit becomes a new revision.
        Incidents keep the revision they were recorded against.
        """
        with store.connect() as db:
            site = owned(db, site_id, p)
        layout = json.loads(dump(site["layout"]))
        change(layout)
        normalize_cameras(layout)
        try:
            revision = publish_layout(engine or client(), site_id, site["revision_id"], layout)
        except LayoutRejected:
            raise HTTPException(422, "TwinForge rejected this camera layout. Reload and try another placement.") from None
        except Exception:
            raise HTTPException(503, "TwinForge is unavailable. Start the engine and retry.") from None
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = owned(db, site_id, p)
            if current["revision_id"] != site["revision_id"]:
                raise HTTPException(409, "The workspace changed while saving. Reload and retry.")
            current["revision_id"] = revision["revision_id"]
            current["layout"] = revision["layout"]
            kept = [c for c in current["monitoring"]["camera_ids"]
                    if c in {cam["id"] for cam in revision["layout"]["cameras"]}]
            if kept != current["monitoring"]["camera_ids"]:
                current["monitoring"]["camera_ids"] = kept
                current["monitoring_version"] = current.get("monitoring_version", 0) + 1
            db.execute("UPDATE sites SET data=? WHERE id=?", (dump(current), site_id))
            event(db, site_id, "layout.changed", site_id)
            audit(db, p["owner"], "layout.changed", revision["revision_id"])
            return current

    @app.post("/v1/sites/{site_id}/cameras", response_model=m.Site, status_code=201)
    def add_camera(site_id: str, body: m.CameraInput, p=Depends(principal)):
        def change(layout):
            if len(layout["cameras"]) >= 8:
                raise HTTPException(409, "This site already has 8 cameras. Remove one first.")
            layout["cameras"].append({**body.model_dump(mode="json"), "id": uid("camera"),
                "floor_id": layout["floors"][0]["id"], "configuration_hash": uid("config"),
                "provenance": {"kind": "manual", "source_ids": [], "confirmed": True, "explanation": OWNER_PLACED}})
        return geometry_edit(site_id, p, change)

    @app.patch("/v1/sites/{site_id}/cameras/{camera_id}", response_model=m.Site)
    def edit_camera(site_id: str, camera_id: str, body: m.CameraEdit, p=Depends(principal)):
        fields = body.model_dump(mode="json", exclude_none=True)
        if not fields:
            raise HTTPException(422, "Send at least one camera field to change")

        def change(layout):
            camera = next((c for c in layout["cameras"] if c["id"] == camera_id), None)
            if not camera:
                raise HTTPException(404, "Camera not found")
            camera.update(fields)
            camera["configuration_hash"] = uid("config")
            camera["provenance"] = {"kind": "manual", "source_ids": [], "confirmed": True,
                                    "explanation": OWNER_EDITED}
        return geometry_edit(site_id, p, change)

    @app.delete("/v1/sites/{site_id}/cameras/{camera_id}", response_model=m.Site)
    def remove_camera(site_id: str, camera_id: str, p=Depends(principal)):
        def change(layout):
            remaining = [c for c in layout["cameras"] if c["id"] != camera_id]
            if len(remaining) == len(layout["cameras"]):
                raise HTTPException(404, "Camera not found")
            layout["cameras"] = remaining
        return geometry_edit(site_id, p, change)

    @app.patch("/v1/sites/{site_id}/rooms/{room_id}", response_model=m.Site)
    def rename_room(site_id: str, room_id: str, body: m.RoomEdit, p=Depends(principal)):
        """Rename a space. Geometry is untouched, so its provenance kind stands."""
        def change(layout):
            room = next((r for r in layout["rooms"] if r["id"] == room_id), None)
            if not room:
                raise HTTPException(404, "Space not found")
            if room["name"] == body.name:
                raise HTTPException(409, "That is already the name")
            room["name"] = body.name
            provenance = room["provenance"]
            provenance["explanation"] = (
                f'Named "{body.name}" by the site owner in SpatialGuard. '
                + provenance["explanation"])[:1000]
        return geometry_edit(site_id, p, change)

    def engine_call(action, *args):
        """Run one TwinForge call, keeping provider response bodies out of the UI."""
        try:
            return action(engine or client(), *args)
        except LayoutRejected:
            raise HTTPException(422, "TwinForge rejected this floor plan. Try a clearer single-floor drawing.") from None
        except Exception:
            raise HTTPException(503, "TwinForge is unavailable. Start the engine and retry.") from None

    def traced_layout(revision_id):
        layout = engine_call(tf.revision, revision_id)["layout"]
        tf.name_largest_room(layout)
        return layout

    def plan_row(db, job_id, p):
        row = db.execute("SELECT * FROM plans WHERE job_id=? AND owner=?", (job_id, p["owner"])).fetchone()
        if not row:
            raise HTTPException(404, "Floor plan job not found")
        return dict(row)

    def plan_state(name, result, layout=None):
        output = result.get("output") or {}
        _, _, width, depth = tf.plan_extent(layout) if layout else (0, 0, 0, 0)
        return m.PlanJob(job_id=result["job_id"], name=name, state=result["state"], layout=layout,
            traced_width_m=round(width, 2), traced_depth_m=round(depth, 2),
            rooms=output.get("spaces_kept", 0), connections=output.get("connections", 0),
            scale_basis=output.get("scale_basis"), label_reader=output.get("label_reader"),
            warning=output.get("warning"), vision_status=output.get("vision_status"),
            vision_error=output.get("vision_error"),
            error="The drawing could not be traced. Try a clearer, single-floor plan."
                  if result["state"] == "failed" else None)

    @app.get("/v1/generation-options", response_model=m.GenerationOptions)
    def generation_options(p=Depends(principal)):
        return engine_call(tf.generation_options)

    @app.post("/v1/plans", response_model=m.PlanJob, status_code=202)
    def create_plan(body: m.PlanInput, p=Depends(principal)):
        with store.connect() as db:
            running = db.execute("SELECT count(*) FROM plans WHERE owner=?", (p["owner"],)).fetchone()[0]
        if running >= 3:
            raise HTTPException(409, "Finish or discard your pending floor plans first.")
        site = engine_call(tf.create_site, body.name)
        suffix = "png" if body.media_type == "image/png" else "jpg"
        asset = engine_call(tf.upload_plan, site["id"], f"floor-plan.{suffix}", body.media_type, body.data_base64)
        result = engine_call(tf.trace_plan, site["id"], asset["asset_id"], body.ceiling_height_m,
                             body.vision_assisted)
        with store.connect() as db:
            db.execute("INSERT INTO plans VALUES (?,?,?,?,?)",
                       (result["job_id"], p["owner"], site["id"], body.name, now()))
            audit(db, p["owner"],
                  "plan.started.vision" if body.vision_assisted else "plan.started", result["job_id"])
        return m.PlanJob(job_id=result["job_id"], name=body.name, state=result["state"])

    @app.get("/v1/plans/{job_id}", response_model=m.PlanJob)
    def plan_status(job_id: str, p=Depends(principal)):
        with store.connect() as db:
            row = plan_row(db, job_id, p)
        result = engine_call(tf.job, job_id)
        layout = None
        if result["state"] == "needs_review":
            layout = traced_layout(result["output"]["revision_id"])
        return plan_state(row["name"], result, layout)

    @app.post("/v1/plans/{job_id}/accept", response_model=m.Site)
    def accept_plan(job_id: str, body: m.PlanAccept, p=Depends(principal)):
        with store.connect() as db:
            row = plan_row(db, job_id, p)
        result = engine_call(tf.job, job_id)
        if result["state"] != "needs_review":
            raise HTTPException(409, "This floor plan is not ready to accept yet.")
        draft = engine_call(tf.revision, result["output"]["revision_id"])
        layout = draft["layout"]
        tf.name_largest_room(layout)
        # Tracing only estimates metres, so the owner's measurements set the scale.
        try:
            tf.verify_scale(layout, body.width_m, body.depth_m)
        except tf.ScaleMismatch as mismatch:
            raise HTTPException(422, "Those dimensions disagree with the drawing by more than 2%. "
                f"At {body.width_m} m wide the drawing is about {mismatch.implied_depth_m} m deep, "
                f"not {body.depth_m} m. Re-measure, or use a drawing that is to scale.") from None
        # The owner has seen the traced plan, so record their review before publishing.
        tf.accept_traced(layout)
        normalize_cameras(layout)
        published = engine_call(tf.publish_draft, draft["revision_id"], layout, draft["version"])
        site = {"id": row["engine_site"], "name": row["name"], "revision_id": published["revision_id"],
                "layout": published["layout"], "monitoring": {"enabled": False, "camera_ids": []},
                "monitoring_version": 0, "evidence_mode": "replay", "ring_status": "not_connected"}
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT OR REPLACE INTO sites VALUES (?,?,?)", (site["id"], p["owner"], dump(site)))
            db.execute("DELETE FROM plans WHERE job_id=?", (job_id,))
            event(db, site["id"], "layout.changed", site["id"])
            audit(db, p["owner"], "plan.accepted", published["revision_id"])
        return site

    @app.delete("/v1/plans/{job_id}", status_code=204)
    def discard_plan(job_id: str, p=Depends(principal)):
        with store.connect() as db:
            row = plan_row(db, job_id, p)
        try:
            (engine or client()).request(f"/v1/jobs/{job_id}/cancel", "POST", {})
        except Exception:
            pass  # A finished or unreachable job still leaves nothing published.
        # Discarding must take the uploaded drawing with it, not leave it stored.
        engine_call(tf.delete_site, row["engine_site"])
        with store.connect() as db:
            db.execute("DELETE FROM plans WHERE job_id=?", (job_id,))
            audit(db, p["owner"], "plan.discarded", job_id)

    @app.get("/v1/sites/{site_id}/floor-plan")
    def floor_plan_image(site_id: str, p=Depends(principal)):
        with store.connect() as db:
            site = owned(db, site_id, p)
        plan = site["layout"].get("floor_plan")
        if not plan:
            raise HTTPException(404, "This site has no floor-plan drawing")
        try:
            media_type, content = (engine or client()).asset(plan["asset_id"])
        except Exception:
            raise HTTPException(503, "TwinForge is unavailable. Start the engine and retry.") from None
        return Response(content, media_type=media_type)

    @app.post("/v1/sites/{site_id}/sessions", response_model=m.MediaSession)
    def media(site_id: str, camera_id: str, p=Depends(principal)):
        with store.connect() as db:
            site = owned(db, site_id, p)
        if camera_id not in {c["id"] for c in site["layout"]["cameras"]}:
            raise HTTPException(404, "Camera not found")
        return m.MediaSession(id=uid("media"), camera_id=camera_id)

    def run_result(db, row):
        incident = db.execute("SELECT id FROM incidents WHERE run_id=?", (row["id"],)).fetchone()
        return m.ReplayRun(id=row["id"], state=row["state"], error=row["error"], incident_id=incident[0] if incident else None)

    @app.post("/v1/sites/{site_id}/replay", response_model=m.ReplayRun, status_code=202)
    def replay(site_id: str, body: m.ReplayInput, p=Depends(principal)):
        require_feature("synthetic_replay")
        with store.connect() as db:
            site = owned(db, site_id, p)
            row = db.execute("SELECT * FROM runs WHERE site_id=? AND request_id=?", (site_id, body.request_id)).fetchone()
            if row:
                return run_result(db, row)
        if not site["monitoring"]["enabled"] or not site["monitoring"]["camera_ids"]:
            raise HTTPException(409, "Enable monitoring and select at least one camera")
        try:
            source = (engine or client()).request(f"/v1/revisions/{site['revision_id']}/replay-fixture")["observations"]
        except Exception:
            if not site["revision_id"].startswith("rev_demo_bundle_v1_"):
                raise HTTPException(503, "TwinForge is unavailable. Start the engine and retry.") from None
            source = tf.bundled_replay(site["id"], site["revision_id"])
        run_id = uid("run")
        observations = []
        for index, obs in enumerate(source):
            if obs["source_id"] not in site["monitoring"]["camera_ids"]:
                continue
            obs["observation_id"] = f"{run_id}_{index}"
            if obs["location"]["kind"] == "unknown":
                obs["category"] = "coverage_gap"
            observations.append(obs)
        payload = {"observations": observations, "camera_ids": site["monitoring"]["camera_ids"], "monitoring_version": site.get("monitoring_version", 0), "created_at": now()}
        with store.connect() as db:
            inserted = db.execute("INSERT OR IGNORE INTO runs(id,site_id,request_id,state,payload) VALUES (?,?,?,'queued',?)", (run_id, site_id, body.request_id, dump(payload))).rowcount
            row = db.execute("SELECT * FROM runs WHERE site_id=? AND request_id=?", (site_id, body.request_id)).fetchone()
            if inserted:
                event(db, site_id, "replay.queued", row["id"])
            return run_result(db, row)

    @app.get("/v1/sites/{site_id}/runs/{run_id}", response_model=m.ReplayRun)
    def get_run(site_id: str, run_id: str, p=Depends(principal)):
        with store.connect() as db:
            owned(db, site_id, p)
            row = db.execute("SELECT * FROM runs WHERE id=? AND site_id=?", (run_id, site_id)).fetchone()
            if not row:
                raise HTTPException(404, "Run not found")
            return run_result(db, row)

    @app.get("/v1/sites/{site_id}/incidents", response_model=m.IncidentPage)
    def incidents(site_id: str, before: int | None = Query(None, ge=1), p=Depends(principal)):
        with store.connect() as db:
            owned(db, site_id, p)
            rows = db.execute("SELECT seq,data FROM incidents WHERE site_id=? AND seq<? ORDER BY seq DESC LIMIT 31", (site_id, before or 9223372036854775807)).fetchall()
            return m.IncidentPage(incidents=[json.loads(r["data"]) for r in rows[:30]], next_cursor=rows[29]["seq"] if len(rows)>30 else None)

    def incident_row(db, incident_id, p):
        row = db.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Incident not found")
        owned(db, row["site_id"], p)
        return json.loads(row["data"])

    @app.get("/v1/incidents/{incident_id}", response_model=m.Incident)
    def incident(incident_id: str, p=Depends(principal)):
        with store.connect() as db:
            return incident_row(db, incident_id, p)

    @app.post("/v1/incidents/{incident_id}/review", response_model=m.Incident)
    def review(incident_id: str, body: m.ReviewInput, p=Depends(principal)):
        with store.connect() as db:
            data = incident_row(db, incident_id, p)
            if data["status"] != "reviewed":
                data.update(status="reviewed", reviewed_at=now())
                db.execute("UPDATE incidents SET data=? WHERE id=?", (dump(data), incident_id))
                event(db, data["site_id"], "incident.reviewed", incident_id)
                audit(db, p["owner"], "incident.reviewed", incident_id)
            return data

    @app.get("/v1/evidence/{evidence_id}", response_model=m.EvidenceAsset)
    def evidence(evidence_id: str, p=Depends(principal)):
        with store.connect() as db:
            row = db.execute("SELECT * FROM evidence WHERE id=?", (evidence_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Evidence not found")
            owned(db, row["site_id"], p)
            return json.loads(row["data"])

    @app.get("/v1/evidence/{evidence_id}/image")
    def evidence_image(evidence_id: str, p=Depends(principal)):
        evidence(evidence_id, p)
        # Authored synthetic schematic: never presented as a real camera frame.
        svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#323232"/><path d="M0 280L240 140H430L640 280M240 140V40M430 140V40" fill="none" stroke="#777" stroke-width="2"/><rect x="278" y="80" width="98" height="204" fill="none" stroke="#D05858" stroke-width="2"/><circle cx="327" cy="117" r="22" fill="#dadada"/><path d="M327 143V225M293 192L327 155L361 192M301 273L327 225L353 273" stroke="#dadada" stroke-width="12" fill="none"/><text x="24" y="32" fill="#fff" font-family="sans-serif" font-size="17">SYNTHETIC REPLAY ILLUSTRATION</text><text x="24" y="336" fill="#dadada" font-family="sans-serif" font-size="15">Not camera footage. Location supplied by the fixture.</text></svg>'
        return Response(svg, media_type="image/svg+xml")

    @app.get("/v1/sites/{site_id}/events", response_model=m.EventPage)
    def events(site_id: str, after: int = Query(0, ge=0), p=Depends(principal)):
        with store.connect() as db:
            owned(db, site_id, p)
            rows = db.execute("SELECT * FROM events WHERE site_id=? AND seq>? ORDER BY seq LIMIT 100", (site_id, after)).fetchall()
            return m.EventPage(events=[m.Event(sequence=r["seq"], kind=r["kind"], resource_id=r["resource"]) for r in rows], cursor=rows[-1]["seq"] if rows else after)

    from .ring_routes import install
    install(app, store, principal, ring_service)
    from .test_video_routes import install as install_test_videos
    install_test_videos(app, principal)

    @app.get("/.well-known/assetlinks.json", include_in_schema=False)
    def android_asset_links():
        fingerprints = [
            value.strip().upper()
            for value in os.environ.get("SPATIALGUARD_ANDROID_SHA256_CERT_FINGERPRINT", "").split(",")
            if value.strip()
        ]
        statements = [{
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": "app.spatialguard.mobile",
                "sha256_cert_fingerprints": fingerprints,
            },
        }] if fingerprints else []
        return Response(content=json.dumps(statements), media_type="application/json")

    dist = ROOT / "spatialguard/apps/web/dist"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        @app.get("/landing", include_in_schema=False)
        @app.get("/signin", include_in_schema=False)
        @app.get("/signup", include_in_schema=False)
        @app.get("/forgot-password", include_in_schema=False)
        @app.get("/reset-password", include_in_schema=False)
        @app.get("/verify-email", include_in_schema=False)
        @app.get("/workspace", include_in_schema=False)
        @app.get("/privacy", include_in_schema=False)
        @app.get("/terms", include_in_schema=False)
        @app.get("/data-deletion", include_in_schema=False)
        def index():
            return FileResponse(dist / "index.html")

        @app.get("/manifest.webmanifest", include_in_schema=False)
        def manifest():
            return FileResponse(dist / "manifest.webmanifest")

        @app.get("/sw.js", include_in_schema=False)
        def service_worker():
            return FileResponse(dist / "sw.js", media_type="application/javascript")

        @app.get("/icon.svg", include_in_schema=False)
        def icon():
            return FileResponse(dist / "icon.svg")

    # Railway exposes one public port, so Ring's account-linking callbacks
    # share the hosted SpatialGuard process. Keep this mount last: owner API
    # and web routes win first, while the gateway handles only /ring/*.
    from .ring_gateway import create_gateway
    app.mount("/", create_gateway(app.state.ring), name="ring-gateway")
    return app
