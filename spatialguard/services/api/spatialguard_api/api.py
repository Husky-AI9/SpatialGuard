import json
import os
import secrets
import time
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .store import Store, ROOT, uid, digest, dump, event, audit, now
from . import models as m
from . import engine as tf
from .engine import LayoutRejected, client, normalize_cameras, publish_layout

COOKIE = "spatialguard_session"


def configured_origin():
    """The one browser origin permitted to hold the hosted owner cookie."""
    return os.environ.get("SPATIALGUARD_ORIGIN", "http://127.0.0.1:8010").rstrip("/")


def create_app(db_path=None, engine=None, ring_service=None):
    store = Store(db_path)
    app = FastAPI(title="SpatialGuard", version="0.1.0")
    app.state.store = store
    app.add_middleware(CORSMiddleware, allow_origins=["https://localhost"], allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"], allow_credentials=False)

    @app.middleware("http")
    async def security(request, call_next):
        allowed_hosts = {"127.0.0.1:8010", "localhost:8010", "testserver"}
        configured_hosts = os.environ.get("SPATIALGUARD_ALLOWED_HOSTS", "")
        allowed_hosts.update(host.strip() for host in configured_hosts.split(",") if host.strip())
        # Railway's health probe may use an internal host before a public
        # domain has been assigned. Keep the probe reachable while preserving
        # the local host guard for application routes.
        if request.url.path != "/health" and request.headers.get("host") not in allowed_hosts:
            return Response(status_code=400)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
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
        return dict(row)

    def owned(db, site_id, p):
        row = db.execute("SELECT data FROM sites WHERE id=? AND owner=?", (site_id, p["owner"])).fetchone()
        if not row:
            raise HTTPException(404, "Site not found")
        return json.loads(row[0])

    def session_data(row):
        return m.Session(id=row["id"], name=row["name"], kind=row["kind"], expires_at=row["expires"])

    def issue(db, owner, kind, name):
        token, sid = secrets.token_urlsafe(32), uid("session")
        expires = time.time() + (86400 * 30 if kind == "android" else 28800)
        db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)", (sid, owner, digest(token), name, kind, expires))
        return m.SessionToken(token=token, session=m.Session(id=sid, name=name, kind=kind, expires_at=expires))

    @app.get("/health")
    def health():
        return {"status": "ok", "application": "spatialguard"}

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

    @app.post("/v1/hosted-session", response_model=m.Session)
    def hosted_session(body: m.HostedSessionInput, request: Request, response: Response):
        """Open one explicit, same-origin owner session for a hosted preview.

        The code is compared in constant time and exists only in the deployment
        environment, never in JavaScript, the APK, or source code.
        """
        hosted_browser(request)
        configured_code = os.environ.get("SPATIALGUARD_HOSTED_ACCESS_CODE", "")
        if not configured_code:
            raise HTTPException(503, "Hosted access is not configured")
        if not secrets.compare_digest(body.access_code, configured_code):
            time.sleep(0.15)
            raise HTTPException(401, "The hosted access code is invalid")
        with store.connect() as db:
            current = db.execute(
                "SELECT * FROM sessions WHERE digest=? AND expires>? AND kind='browser'",
                (digest(request.cookies.get(COOKIE, "")), time.time()),
            ).fetchone()
            if current and current["owner"] == "hosted_owner":
                return session_data(current)
            db.execute("DELETE FROM sessions WHERE expires<=?", (time.time(),))
            db.execute(
                """DELETE FROM sessions WHERE kind='browser' AND owner='hosted_owner'
                AND id NOT IN (SELECT id FROM sessions WHERE kind='browser' AND owner='hosted_owner'
                ORDER BY expires DESC LIMIT 4)"""
            )
            result = issue(db, "hosted_owner", "browser", "Hosted owner browser")
        response.set_cookie(
            COOKIE, result.token, httponly=True, samesite="lax", secure=True,
            max_age=28800, path="/",
        )
        return result.session

    @app.get("/v1/me", response_model=m.Session)
    def me(p=Depends(principal)):
        return session_data(p)

    @app.get("/v1/sessions", response_model=list[m.Session])
    def sessions(p=Depends(principal)):
        with store.connect() as db:
            return [session_data(r) for r in db.execute("SELECT * FROM sessions WHERE owner=? AND expires>?", (p["owner"], time.time()))]

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

    @app.get("/v1/sites", response_model=list[m.Site])
    def sites(p=Depends(principal)):
        with store.connect() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT data FROM sites WHERE owner=?", (p["owner"],))]

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
        site = engine_call(tf.sample_site, store, p["owner"])
        with store.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (active_key(p), site["id"]))
            audit(db, p["owner"], "sample.loaded", site["id"])
        return site

    @app.patch("/v1/sites/{site_id}/monitoring", response_model=m.Site)
    def monitoring(site_id: str, body: m.Monitoring, p=Depends(principal)):
        with store.connect() as db:
            site = owned(db, site_id, p)
            allowed = {c["id"] for c in site["layout"]["cameras"]}
            if len(set(body.camera_ids)) != len(body.camera_ids) or not set(body.camera_ids) <= allowed:
                raise HTTPException(422, "Select cameras in this site")
            site["monitoring"] = body.model_dump()
            site["monitoring_version"] = site.get("monitoring_version", 0) + 1
            db.execute("UPDATE sites SET data=? WHERE id=?", (dump(site), site_id))
            event(db, site_id, "monitoring.changed", site_id)
            audit(db, p["owner"], "monitoring.changed", site_id)
            return site

    @app.delete("/v1/sites/{site_id}", status_code=204)
    def remove_site(site_id: str, p=Depends(principal)):
        """Remove a place and everything recorded against it, drawing included."""
        with store.connect() as db:
            owned(db, site_id, p)
        # Delete upstream first: a local row is recoverable, an orphaned drawing is not.
        engine_call(tf.delete_site, site_id)
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for table in ("incidents", "evidence", "runs", "events"):
                db.execute(f"DELETE FROM {table} WHERE site_id=?", (site_id,))
            db.execute("DELETE FROM sites WHERE id=? AND owner=?", (site_id, p["owner"]))
            db.execute("DELETE FROM settings WHERE key=? AND value=?", (active_key(p), site_id))
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
            raise HTTPException(503, "TwinForge is unavailable. Start the engine and retry.") from None
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

    dist = ROOT / "spatialguard/apps/web/dist"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/")
        @app.get("/landing", include_in_schema=False)
        @app.get("/workspace", include_in_schema=False)
        def index():
            return FileResponse(dist / "index.html")

        @app.get("/manifest.webmanifest")
        def manifest():
            return FileResponse(dist / "manifest.webmanifest")

        @app.get("/sw.js")
        def service_worker():
            return FileResponse(dist / "sw.js", media_type="application/javascript")

        @app.get("/icon.svg")
        def icon():
            return FileResponse(dist / "icon.svg")

    # Railway exposes one public port, so Ring's account-linking callbacks
    # share the hosted SpatialGuard process. Keep this mount last: owner API
    # and web routes win first, while the gateway handles only /ring/*.
    from .ring_gateway import create_gateway
    app.mount("/", create_gateway(app.state.ring), name="ring-gateway")
    return app
