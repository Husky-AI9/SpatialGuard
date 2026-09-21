import asyncio
import base64
import hashlib
import io
import json
import os
import secrets
import sqlite3
import time
from ipaddress import ip_address
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI, Depends, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from shapely.geometry import Point, Polygon
from .models import (
    Layout,
    Floor,
    SiteInput,
    DraftInput,
    Query,
    CalibrationInput,
    ProjectionInput,
    ObservationBatch,
    PointLocation,
    RoomLocation,
    AssetInput,
    ImportInput,
)
from .geometry import (
    canonical_hash,
    validate_layout,
    query_layout,
    fit_calibration,
    project,
)
from .store import Store, now, uid, dump, event, revision_record
from .fixture import synthetic_layout, replay, calibration_fixture
from .examples import local_examples


class ApiError(Exception):
    def __init__(self, status, code, message, details=None):
        self.status, self.code, self.message, self.details = (
            status,
            code,
            message,
            details or [],
        )


def fail(status, code, message, details=None):
    raise ApiError(status, code, message, details)


def owned(db, table, identifier, tenant):
    # Table names are internal constants, never request input.
    row = db.execute(
        f"SELECT * FROM {table} WHERE id=? AND tenant_id=?", (identifier, tenant)
    ).fetchone()
    if row is None:
        fail(404, "not_found", "Resource not found")
    return row


def check_assets(db, layout, tenant, site):
    refs = set(layout.asset_ids)
    if layout.floor_plan:
        refs.add(layout.floor_plan.asset_id)
    for entity in layout.rooms + layout.zones + layout.portals + layout.cameras:
        refs.update(entity.provenance.source_ids)
    for asset in refs:
        row = owned(db, "assets", asset, tenant)
        if row["site_id"] != site:
            fail(422, "asset_site", "Asset belongs to a different site")


def insert_revision(db, tenant, site, layout, parent=None):
    rid = uid("rev")
    db.execute(
        "INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?)",
        (
            rid,
            tenant,
            site,
            parent,
            "draft",
            1,
            None,
            dump(layout.model_dump(mode="json")),
            now(),
        ),
    )
    event(db, tenant, site, "revision.created", {"revision_id": rid})
    return revision_record(owned(db, "revisions", rid, tenant))


def sanitize_image(name, media_type, data_base64):
    """Validate an uploaded image and re-encode it without metadata."""
    if any(c in name for c in ("/", "\\", "\x00")) or name in (".", ".."):
        fail(422, "unsafe_name", "Asset name must not contain a path")
    try:
        content = base64.b64decode(data_base64, validate=True)
        if len(content) > 6_000_000:
            fail(413, "too_large", "Image limit is 6 MB")
        with Image.open(io.BytesIO(content)) as im:
            if im.width * im.height > 20_000_000 or im.format not in ("PNG", "JPEG"):
                fail(
                    422,
                    "invalid_image",
                    "Supported images: PNG/JPEG, at most 20 megapixels",
                )
            actual = "image/png" if im.format == "PNG" else "image/jpeg"
            if actual != media_type:
                fail(422, "media_mismatch", "Media type does not match signature")
            # Re-encode to strip EXIF and discard unexpected trailing payloads.
            clean = io.BytesIO()
            im.convert("RGB").save(
                clean, format="PNG" if actual == "image/png" else "JPEG"
            )
            content = clean.getvalue()
            if len(content) > 6_000_000:
                fail(413, "too_large", "Sanitized image exceeds the 6 MB storage limit")
            dimensions = [im.width, im.height]
    except (
        ValueError,
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
    ):
        fail(422, "invalid_image", "Image could not be safely decoded")
    return content, dimensions


def asset_metadata(asset_id, body, content, dimensions):
    return {
        "asset_id": asset_id,
        "name": body.name,
        "media_type": body.media_type,
        "checksum": hashlib.sha256(content).hexdigest(),
        "dimensions": dimensions,
        "license": body.license,
        "consent": body.consent,
    }


def create_app(db_path=None):
    app = FastAPI(
        title="TwinForge",
        version="0.1.0",
        description="Provider-independent spatial engine. Local owner/viewer tokens; synthetic replay explicitly labeled.",
    )
    store = Store(db_path)
    app.state.store = store
    local_sessions_enabled = os.environ.get("TWINFORGE_LOCAL_SESSION") == "1"
    local_sessions = {}
    session_cookie = "twinforge_local_session"

    def local_request(request: Request):
        try:
            loopback = request.client is not None and ip_address(request.client.host).is_loopback
        except ValueError:
            loopback = False
        # Check the actual Host, not forwarded headers. A custom header prevents
        # cross-origin forms/images from opening a privileged local session.
        origin = request.headers.get("origin")
        expected_origin = f"{request.url.scheme}://{request.headers.get('host', '')}"
        if (
            not loopback
            or request.url.hostname not in {"127.0.0.1", "localhost", "::1"}
            or request.headers.get("x-twinforge-local") != "1"
            or request.headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "none"}
            or (origin is not None and origin != expected_origin)
        ):
            fail(403, "local_only", "Local workspace sessions require a same-origin loopback request")

    @app.middleware("http")
    async def limits(request: Request, call_next):
        request.state.request_id = uuid4().hex
        # Bound both chunked and Content-Length requests before JSON decoding.
        if request.method in ("POST", "PATCH", "PUT"):
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > 9_000_000:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "code": "too_large",
                            "message": "Request limit is 9 MB",
                            "request_id": request.state.request_id,
                            "details": [],
                        },
                    )
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/v1"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ApiError)
    async def api_error(request, exc):
        return JSONResponse(
            status_code=exc.status,
            content={
                "code": exc.code,
                "message": exc.message,
                "request_id": request.state.request_id,
                "details": exc.details,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(
            status_code=422,
            content={
                "code": "invalid_request",
                "message": "Request validation failed",
                "request_id": request.state.request_id,
                "details": [
                    {"field": ".".join(map(str, e["loc"])), "message": e["msg"]}
                    for e in exc.errors()
                ],
            },
        )

    def principal(request: Request, authorization: str | None = Header(default=None)):
        if authorization is not None:
            if not authorization.startswith("Bearer "):
                fail(401, "unauthenticated", "Invalid authorization header")
            digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
        else:
            session = local_sessions.get(request.cookies.get(session_cookie)) if local_sessions_enabled else None
            if not session or session[1] <= time.time():
                fail(401, "unauthenticated", "A bearer token or local workspace session is required")
            local_request(request)
            digest = session[0]
        with store.connect() as db:
            member = db.execute(
                "SELECT tenant_id,role FROM memberships WHERE token_hash=?", (digest,)
            ).fetchone()
        if not member:
            fail(401, "unauthenticated", "Invalid or revoked token")
        return dict(member)

    def owner(p=Depends(principal)):
        if p["role"] != "owner":
            fail(403, "forbidden", "Owner role required")
        return p

    @app.get("/health")
    def health():
        return {"status": "ok", "version": "0.1.0"}

    @app.post("/v1/local-session")
    def start_local_session(request: Request, response: Response):
        if not local_sessions_enabled:
            fail(404, "not_found", "Automatic local sessions are not enabled")
        local_request(request)
        try:
            credentials = json.loads((store.path.parent / "credentials.json").read_text(encoding="utf-8"))
            digest = hashlib.sha256(credentials["owner_token"].encode()).hexdigest()
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            fail(503, "local_setup", "Initialize the local workspace with python -m twinforge.cli init")
        with store.connect() as db:
            member = db.execute("SELECT tenant_id,role FROM memberships WHERE token_hash=?", (digest,)).fetchone()
        if not member or member["role"] != "owner":
            fail(503, "local_setup", "The local owner credential is missing or revoked")
        # The membership lookup determines tenant/role; never credentials JSON's tenant_id.
        expired = [key for key, value in local_sessions.items() if value[1] <= time.time()]
        for key in expired:
            local_sessions.pop(key, None)
        session_id = request.cookies.get(session_cookie)
        if session_id not in local_sessions or local_sessions[session_id][0] != digest:
            if len(local_sessions) >= 256:
                fail(429, "session_limit", "Too many local workspace sessions")
            session_id = secrets.token_urlsafe(32)
        local_sessions[session_id] = (digest, time.time() + 8 * 60 * 60)
        response.set_cookie(session_cookie, session_id, httponly=True, samesite="strict",
                            secure=request.url.scheme == "https", max_age=8 * 60 * 60, path="/v1")
        return {"mode": "local", **dict(member)}

    @app.get("/v1/me")
    def me(p=Depends(principal)):
        return p

    @app.get("/v1/generation-options")
    def generation_options(p=Depends(principal)):
        return {"vision_available": bool(os.environ.get("OPENAI_API_KEY", "").strip())}

    @app.get("/v1/sites")
    def sites(p=Depends(principal)):
        with store.connect() as db:
            return [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM sites WHERE tenant_id=? ORDER BY created_at",
                    (p["tenant_id"],),
                )
            ]

    @app.post("/v1/sites", status_code=201)
    def create_site(
        body: SiteInput,
        p=Depends(owner),
        idempotency_key: str | None = Header(default=None),
    ):
        tenant = p["tenant_id"]
        with store.connect() as db:
            body_hash = canonical_hash(body.model_dump())
            if idempotency_key:
                cached = db.execute(
                    "SELECT * FROM idempotency WHERE tenant_id=? AND operation='site' AND key=?",
                    (tenant, idempotency_key),
                ).fetchone()
                if cached:
                    if cached["body_hash"] != body_hash:
                        fail(
                            409,
                            "idempotency_conflict",
                            "Idempotency key was used with different content",
                        )
                    return json.loads(cached["response"])
            sid = uid("site")
            record = {
                "id": sid,
                "tenant_id": tenant,
                "name": body.name,
                "created_at": now(),
            }
            db.execute("INSERT INTO sites VALUES (?,?,?,?)", tuple(record.values()))
            if idempotency_key:
                db.execute(
                    "INSERT INTO idempotency VALUES (?,?,?,?,?)",
                    (tenant, "site", idempotency_key, body_hash, dump(record)),
                )
            return record

    @app.get("/v1/examples")
    def examples(p=Depends(principal)):
        return [
            example.model_dump(exclude={"layout"})
            for example in local_examples(store.path.parent, p["tenant_id"]).values()
        ]

    @app.post("/v1/examples/{example_id}/load", status_code=201)
    def load_example(example_id: str, p=Depends(owner)):
        example = local_examples(store.path.parent, p["tenant_id"]).get(example_id)
        if example is None:
            fail(404, "not_found", "Example not found")
        with store.connect() as db:
            site = {"id": uid("site"), "tenant_id": p["tenant_id"],
                    "name": example.name, "created_at": now()}
            db.execute("INSERT INTO sites VALUES (?,?,?,?)", tuple(site.values()))
            check_assets(db, example.layout, p["tenant_id"], site["id"])
            revision = insert_revision(db, p["tenant_id"], site["id"], example.layout)
        return {"site": site, "revision": revision}

    @app.post("/v1/sites/{site}/fixture")
    def load_fixture(site: str, p=Depends(owner)):
        with store.connect() as db:
            owned(db, "sites", site, p["tenant_id"])
            return insert_revision(db, p["tenant_id"], site, synthetic_layout())

    @app.get("/v1/sites/{site}/revisions")
    def revisions(site: str, p=Depends(principal)):
        with store.connect() as db:
            owned(db, "sites", site, p["tenant_id"])
            return [
                revision_record(r)
                for r in db.execute(
                    "SELECT * FROM revisions WHERE tenant_id=? AND site_id=? ORDER BY created_at DESC",
                    (p["tenant_id"], site),
                )
            ]

    @app.post("/v1/sites/{site}/revisions", status_code=201)
    def draft(site: str, body: DraftInput, p=Depends(owner)):
        tenant = p["tenant_id"]
        with store.connect() as db:
            owned(db, "sites", site, tenant)
            if body.parent_revision_id:
                parent = owned(db, "revisions", body.parent_revision_id, tenant)
                if parent["site_id"] != site:
                    fail(422, "parent_site", "Parent belongs to another site")
                layout = body.layout or Layout.model_validate_json(parent["layout"])
            else:
                layout = body.layout or Layout(
                    floors=[Floor(id="floor_0", name="Ground floor")]
                )
            errors = validate_layout(layout)
            if errors:
                fail(422, "invalid_geometry", "Layout validation failed", errors)
            check_assets(db, layout, tenant, site)
            return insert_revision(db, tenant, site, layout, body.parent_revision_id)

    @app.get("/v1/revisions/{revision}")
    def read_revision(revision: str, response: Response, p=Depends(principal)):
        with store.connect() as db:
            row = owned(db, "revisions", revision, p["tenant_id"])
            response.headers["ETag"] = f'"{row["version"]}"'
            return revision_record(row)

    def editable(row, if_match):
        if row["state"] != "draft":
            fail(
                409,
                "immutable_revision",
                "Published revisions are immutable; create a new draft",
            )
        if if_match != f'"{row["version"]}"':
            fail(
                409,
                "revision_conflict",
                "Draft changed or If-Match is missing; reload before saving",
            )

    @app.patch("/v1/revisions/{revision}")
    def edit(
        revision: str,
        body: Layout,
        p=Depends(owner),
        if_match: str | None = Header(default=None),
    ):
        with store.connect() as db:
            row = owned(db, "revisions", revision, p["tenant_id"])
            editable(row, if_match)
            errors = validate_layout(body)
            if errors:
                fail(422, "invalid_geometry", "Layout validation failed", errors)
            check_assets(db, body, p["tenant_id"], row["site_id"])
            db.execute(
                "UPDATE revisions SET layout=?,version=version+1 WHERE id=?",
                (dump(body.model_dump(mode="json")), revision),
            )
            event(
                db,
                p["tenant_id"],
                row["site_id"],
                "revision.updated",
                {"revision_id": revision},
            )
            return revision_record(owned(db, "revisions", revision, p["tenant_id"]))

    @app.post("/v1/revisions/{revision}/publish")
    def publish(
        revision: str, p=Depends(owner), if_match: str | None = Header(default=None)
    ):
        with store.connect() as db:
            row = owned(db, "revisions", revision, p["tenant_id"])
            editable(row, if_match)
            layout = Layout.model_validate_json(row["layout"])
            errors = validate_layout(layout, True)
            if errors:
                fail(
                    422, "publish_blocked", "Review required before publication", errors
                )
            check_assets(db, layout, p["tenant_id"], row["site_id"])
            content_hash = canonical_hash(layout.model_dump(mode="json"))
            db.execute(
                "UPDATE revisions SET state='published',hash=?,version=version+1 WHERE id=?",
                (content_hash, revision),
            )
            db.execute(
                "UPDATE jobs SET state='succeeded' WHERE tenant_id=? AND state='needs_review' AND json_extract(output,'$.revision_id')=?",
                (p["tenant_id"], revision),
            )
            event(
                db,
                p["tenant_id"],
                row["site_id"],
                "revision.published",
                {"revision_id": revision, "content_hash": content_hash},
            )
            return revision_record(owned(db, "revisions", revision, p["tenant_id"]))

    @app.post("/v1/revisions/{revision}/query")
    def query(revision: str, body: Query, p=Depends(principal)):
        with store.connect() as db:
            row = owned(db, "revisions", revision, p["tenant_id"])
        try:
            return {
                "revision_id": revision,
                **query_layout(Layout.model_validate_json(row["layout"]), body),
            }
        except ValueError as e:
            fail(422, "invalid_query", str(e))

    @app.get("/v1/revisions/{revision}/diff/{other}")
    def diff(revision: str, other: str, p=Depends(principal)):
        with store.connect() as db:
            a = owned(db, "revisions", revision, p["tenant_id"])
            b = owned(db, "revisions", other, p["tenant_id"])
            if a["site_id"] != b["site_id"]:
                fail(422, "site_mismatch", "Compare revisions of the same site")
        left, right = json.loads(a["layout"]), json.loads(b["layout"])
        changes = {}
        for key in ("rooms", "zones", "portals", "cameras"):
            aa, bb = {o["id"]: o for o in left[key]}, {o["id"]: o for o in right[key]}
            changes[key] = {
                "added": sorted(bb.keys() - aa.keys()),
                "removed": sorted(aa.keys() - bb.keys()),
                "changed": sorted(i for i in aa.keys() & bb.keys() if aa[i] != bb[i]),
            }
        return {
            "from_revision": revision,
            "to_revision": other,
            "changes": changes,
            "scale_changed": left["scale_anchors"] != right["scale_anchors"]
            or left["scale_status"] != right["scale_status"],
        }

    @app.post("/v1/revisions/{revision}/calibrations")
    def calibrate(revision: str, body: CalibrationInput, p=Depends(owner)):
        with store.connect() as db:
            row = owned(db, "revisions", revision, p["tenant_id"])
            if row["state"] != "published":
                fail(
                    409,
                    "publish_first",
                    "Calibration must be pinned to published geometry",
                )
            layout = Layout.model_validate_json(row["layout"])
            camera = next((c for c in layout.cameras if c.id == body.camera_id), None)
            if not camera or camera.configuration_hash != body.configuration_hash:
                fail(
                    422,
                    "camera_mismatch",
                    "Camera configuration does not match this revision",
                )
            try:
                fitted = fit_calibration(body)
            except ValueError as e:
                fail(422, "invalid_calibration", str(e))
            cid = uid("cal")
            record = {
                "calibration_id": cid,
                "revision_id": revision,
                "floor_id": camera.floor_id,
                **body.model_dump(mode="json"),
                **fitted,
                "created_at": now(),
            }
            db.execute(
                "INSERT INTO calibrations VALUES (?,?,?,?)",
                (cid, p["tenant_id"], revision, dump(record)),
            )
            return record

    @app.get("/v1/revisions/{revision}/calibrations")
    def calibrations(revision: str, p=Depends(principal)):
        with store.connect() as db:
            owned(db, "revisions", revision, p["tenant_id"])
            return [
                json.loads(r["data"])
                for r in db.execute(
                    "SELECT data FROM calibrations WHERE tenant_id=? AND revision_id=?",
                    (p["tenant_id"], revision),
                )
            ]

    @app.post("/v1/calibrations/{calibration}/project")
    def projection(calibration: str, body: ProjectionInput, p=Depends(principal)):
        with store.connect() as db:
            cal = json.loads(
                owned(db, "calibrations", calibration, p["tenant_id"])["data"]
            )
        reason = None
        if cal["quality"] != "accepted":
            reason = "Calibration is not accepted"
        elif (
            body.configuration_hash != cal["configuration_hash"]
            or list(body.resolution) != cal["resolution"]
        ):
            reason = "Camera configuration or resolution changed"
        elif not Polygon(cal["image_region"]).covers(Point(body.image_xy)):
            reason = "Point is outside the calibrated image region"
        if reason:
            return {"kind": "unknown", "reason": reason}
        try:
            xy = project(cal["homography"], body.image_xy)
        except ValueError as e:
            return {"kind": "unknown", "reason": str(e)}
        return {
            "kind": "floor_point",
            "floor_id": cal["floor_id"],
            "xy_m": xy,
            "uncertainty_radius_m": max(0.05, cal["report"]["p95_error_m"]),
            "calibration_id": calibration,
        }

    @app.post("/v1/observations:batch")
    def observations_batch(body: ObservationBatch, p=Depends(owner)):
        inserted = 0
        with store.connect() as db:
            for o in body.observations:
                row = owned(db, "revisions", o.revision_id, p["tenant_id"])
                if row["site_id"] != o.site_id or row["state"] != "published":
                    fail(
                        422,
                        "revision_mismatch",
                        "Observation requires a published revision of its site",
                    )
                layout = Layout.model_validate_json(row["layout"])
                if o.source_id not in {c.id for c in layout.cameras}:
                    fail(
                        422, "source_mismatch", "Source camera is not in this revision"
                    )
                if isinstance(o.location, PointLocation):
                    if (
                        o.evidence.mode != "replay"
                        and o.provenance.kind == "inferred"
                        and not o.location.calibration_id
                    ):
                        fail(
                            422,
                            "calibration_required",
                            "Inferred camera coordinates require an accepted calibration; otherwise use room or unknown",
                        )
                    if o.location.floor_id not in {f.id for f in layout.floors}:
                        fail(422, "floor_mismatch", "Unknown floor")
                    if o.location.calibration_id:
                        cal = owned(
                            db,
                            "calibrations",
                            o.location.calibration_id,
                            p["tenant_id"],
                        )
                        data = json.loads(cal["data"])
                        if (
                            cal["revision_id"] != o.revision_id
                            or data["camera_id"] != o.source_id
                            or data["quality"] != "accepted"
                        ):
                            fail(
                                422,
                                "calibration_mismatch",
                                "Calibration does not support this observation",
                            )
                if isinstance(o.location, RoomLocation) and o.location.room_id not in {
                    r.id for r in layout.rooms
                }:
                    fail(422, "room_mismatch", "Unknown room")
                refs = set(o.provenance.source_ids)
                if o.evidence.asset_id:
                    refs.add(o.evidence.asset_id)
                for aid in refs:
                    asset = owned(db, "assets", aid, p["tenant_id"])
                    if asset["site_id"] != o.site_id:
                        fail(422, "asset_site", "Evidence belongs to another site")
                data = dump(o.model_dump(mode="json"))
                old = db.execute(
                    "SELECT data FROM observations WHERE tenant_id=? AND id=?",
                    (p["tenant_id"], o.observation_id),
                ).fetchone()
                if old:
                    if old["data"] != data:
                        fail(
                            409,
                            "observation_conflict",
                            "Observation ID already contains different evidence",
                        )
                    continue
                db.execute(
                    "INSERT INTO observations(tenant_id,id,site_id,revision_id,observed_at,data) VALUES (?,?,?,?,?,?)",
                    (
                        p["tenant_id"],
                        o.observation_id,
                        o.site_id,
                        o.revision_id,
                        o.observed_at.isoformat(),
                        data,
                    ),
                )
                inserted += 1
                event(
                    db,
                    p["tenant_id"],
                    o.site_id,
                    "observation.created",
                    {"observation_id": o.observation_id, "revision_id": o.revision_id},
                )
        return {"inserted": inserted, "duplicates": len(body.observations) - inserted}

    @app.get("/v1/sites/{site}/observations")
    def observations(site: str, revision_id: str | None = None, p=Depends(principal)):
        with store.connect() as db:
            owned(db, "sites", site, p["tenant_id"])
            rows = db.execute(
                "SELECT data,arrival FROM observations WHERE tenant_id=? AND site_id=? AND (? IS NULL OR revision_id=?) ORDER BY observed_at,arrival LIMIT 2000",
                (p["tenant_id"], site, revision_id, revision_id),
            )
            return [
                {**json.loads(r["data"]), "arrival_sequence": r["arrival"]}
                for r in rows
            ]

    @app.get("/v1/revisions/{revision}/replay-fixture")
    def fixture_observations(revision: str, p=Depends(principal)):
        with store.connect() as db:
            row = owned(db, "revisions", revision, p["tenant_id"])
        return {
            "observations": replay(row["site_id"], revision),
            "calibration": calibration_fixture(),
        }

    @app.post("/v1/sites/{site}/assets", status_code=201)
    def upload_asset(site: str, body: AssetInput, p=Depends(owner)):
        content, dimensions = sanitize_image(
            body.name, body.media_type, body.data_base64
        )
        with store.connect() as db:
            owned(db, "sites", site, p["tenant_id"])
            aid = uid("asset")
            metadata = asset_metadata(aid, body, content, dimensions)
            db.execute(
                "INSERT INTO assets VALUES (?,?,?,?,?)",
                (aid, p["tenant_id"], site, dump(metadata), content),
            )
            return metadata

    @app.get("/v1/assets/{asset}")
    def asset(asset: str, p=Depends(principal)):
        with store.connect() as db:
            row = owned(db, "assets", asset, p["tenant_id"])
        return Response(
            row["content"],
            media_type=json.loads(row["metadata"])["media_type"],
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/v1/revisions/{revision}/exports")
    def export(revision: str, p=Depends(principal)):
        with store.connect() as db:
            row = owned(db, "revisions", revision, p["tenant_id"])
            if row["state"] != "published":
                fail(409, "publish_first", "Export a published snapshot")
            layout = json.loads(row["layout"])
            # Portable geometry excludes raw media. Preserve source references with manifest entries.
            refs = set(layout["asset_ids"])
            if layout.get("floor_plan"):
                refs.add(layout["floor_plan"]["asset_id"])
            for group in ("rooms", "zones", "portals", "cameras"):
                for entity in layout[group]:
                    refs.update(entity["provenance"]["source_ids"])
            assets = [
                json.loads(owned(db, "assets", aid, p["tenant_id"])["metadata"])
                for aid in sorted(refs)
            ]
            return {
                "format": "twinforge.bundle",
                "schema_version": "0.1",
                "layout": layout,
                "content_hash": row["hash"],
                "assets": assets,
                "media_included": False,
            }

    @app.post("/v1/sites/{site}/imports", status_code=202)
    def imports(site: str, body: ImportInput, p=Depends(owner)):
        with store.connect() as db:
            owned(db, "sites", site, p["tenant_id"])
            if body.asset_id:
                asset = owned(db, "assets", body.asset_id, p["tenant_id"])
                if asset["site_id"] != site:
                    fail(422, "asset_site", "Asset belongs to a different site")
            count = db.execute(
                "SELECT count(*) FROM jobs WHERE tenant_id=? AND state IN ('queued','running')",
                (p["tenant_id"],),
            ).fetchone()[0]
            if count >= 4:
                fail(429, "job_limit", "At most four active jobs per tenant")
            jid = uid("job")
            db.execute(
                "INSERT INTO jobs(id,tenant_id,site_id,state,kind,payload,created_at) VALUES (?,?,?,'queued',?,?,?)",
                (jid, p["tenant_id"], site, body.kind, dump(body.model_dump()), now()),
            )
            return {"job_id": jid, "state": "queued"}

    @app.get("/v1/jobs/{job}")
    def get_job(job: str, p=Depends(principal)):
        with store.connect() as db:
            row = owned(db, "jobs", job, p["tenant_id"])
            return {
                "job_id": row["id"],
                "state": row["state"],
                "attempts": row["attempts"],
                "output": json.loads(row["output"]) if row["output"] else None,
                "error": row["error"],
            }

    @app.post("/v1/jobs/{job}/cancel")
    def cancel(job: str, p=Depends(owner)):
        with store.connect() as db:
            row = owned(db, "jobs", job, p["tenant_id"])
            if row["state"] in ("queued", "running"):
                db.execute(
                    "UPDATE jobs SET state='cancelled',lease_until=NULL WHERE id=?",
                    (job,),
                )
                return {"job_id": job, "state": "cancelled"}
            return {"job_id": job, "state": row["state"]}

    @app.get("/v1/sites/{site}/events")
    async def events(
        site: str,
        request: Request,
        after: int = 0,
        last_event_id: str | None = Header(default=None),
        p=Depends(principal),
    ):
        with store.connect() as db:
            owned(db, "sites", site, p["tenant_id"])
        try:
            cursor = max(after, int(last_event_id or 0))
        except ValueError:
            fail(422, "invalid_cursor", "Last-Event-ID must be an integer")

        async def stream():
            nonlocal cursor
            # Bounded connection lifetime forces authorization renewal on reconnect.
            for _ in range(25):
                if await request.is_disconnected():
                    break
                try:
                    principal(request, request.headers.get("authorization"))
                except ApiError:
                    break
                with store.connect() as db:
                    rows = db.execute(
                        "SELECT * FROM events WHERE tenant_id=? AND site_id=? AND cursor>? ORDER BY cursor LIMIT 100",
                        (p["tenant_id"], site, cursor),
                    ).fetchall()
                for row in rows:
                    cursor = row["cursor"]
                    yield f'id: {cursor}\nevent: {row["kind"]}\ndata: {row["data"]}\n\n'
                yield ": heartbeat\n\n"
                await asyncio.sleep(1)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no"},
        )

    @app.delete("/v1/sites/{site}", status_code=204)
    def delete_site(site: str, p=Depends(owner)):
        with store.connect() as db:
            owned(db, "sites", site, p["tenant_id"])
            db.execute(
                "DELETE FROM calibrations WHERE revision_id IN (SELECT id FROM revisions WHERE site_id=? AND tenant_id=?)",
                (site, p["tenant_id"]),
            )
            for table in ("observations", "assets", "jobs", "events", "revisions"):
                db.execute(
                    f"DELETE FROM {table} WHERE site_id=? AND tenant_id=?",
                    (site, p["tenant_id"]),
                )
            db.execute(
                "DELETE FROM sites WHERE id=? AND tenant_id=?", (site, p["tenant_id"])
            )
        return Response(status_code=204)

    built = Path(__file__).resolve().parents[3] / "apps" / "viewer" / "dist"
    if built.exists():
        app.mount("/", StaticFiles(directory=built, html=True), name="viewer")
    return app
