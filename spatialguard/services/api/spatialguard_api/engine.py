"""Only this application adapter knows TwinForge's HTTP interface."""
import json
import os
import re
from urllib.error import HTTPError
from twinforge_sdk import TwinForge
from .store import ROOT


# Ring publishes one horizontal field of view per camera model (Stick Up Cam Battery
# 110 deg, Indoor Cam 2nd Gen 115 deg, Floodlight Cam Plus/Pro 140 deg). The preview
# models a single Ring camera model, so field of view is a lens fact shared by every
# camera rather than a per-camera setting the owner dials in.
RING_FOV_DEGREES = 110


def normalize_cameras(layout):
    """Give every camera the Ring lens field of view. Returns True if anything changed."""
    changed = False
    for camera in layout["cameras"]:
        if camera.get("fov_degrees") != RING_FOV_DEGREES:
            camera["fov_degrees"] = RING_FOV_DEGREES
            changed = True
    return changed


class LayoutRejected(Exception):
    """TwinForge refused the geometry. Provider response bodies never reach the UI."""


def client():
    token = os.environ.get("SPATIALGUARD_TWINFORGE_TOKEN")
    if not token:
        token = json.loads((ROOT / ".data/credentials.json").read_text(encoding="utf-8"))["owner_token"]
    return TwinForge(os.environ.get("SPATIALGUARD_TWINFORGE_URL", "http://127.0.0.1:8000"), token)


def sample_site(engine, store, owner="local_owner"):
    """Create the synthetic demo place, or return it if the owner already has it.

    Built on request rather than at startup so a fresh workspace opens empty and
    the owner chooses between their own floor plan and the sample.
    """
    from .store import dump
    with store.connect() as db:
        row = db.execute("SELECT value FROM settings WHERE key='engine_site'").fetchone()
    if row:
        site_id = row[0]
    else:
        site_id = engine.request("/v1/sites", "POST", {"name": "SpatialGuard - synthetic demo"})["id"]
        with store.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES ('engine_site',?)", (site_id,))
    with store.connect() as db:
        existing = db.execute("SELECT data FROM sites WHERE id=? AND owner=?", (site_id, owner)).fetchone()
    if existing:
        return relens(store, engine, json.loads(existing[0]))
    revisions = engine.request(f"/v1/sites/{site_id}/revisions")
    revision = next((r for r in revisions if r["state"] == "published"), None)
    if not revision:
        revision = engine.request(f"/v1/sites/{site_id}/fixture", "POST")
        revision = engine.request(f"/v1/revisions/{revision['revision_id']}/publish", "POST", version=revision["version"])
    data = {"id": site_id, "name": "Demo home", "revision_id": revision["revision_id"],
            "layout": revision["layout"], "monitoring": {"enabled": True,
            "camera_ids": [c["id"] for c in revision["layout"]["cameras"]]},
            "evidence_mode": "replay", "ring_status": "not_connected"}
    with store.connect() as db:
        db.execute("INSERT INTO sites VALUES (?,?,?)", (site_id, owner, dump(data)))
    return relens(store, engine, data)


def relens(store, engine, data):
    """Bring a stored site onto the Ring lens spec, publishing a revision only if it drifted."""
    from .store import dump
    if not normalize_cameras(data["layout"]):
        return data
    revision = publish_layout(engine, data["id"], data["revision_id"], data["layout"])
    data["revision_id"] = revision["revision_id"]
    data["layout"] = revision["layout"]
    with store.connect() as db:
        db.execute("UPDATE sites SET data=? WHERE id=?", (dump(data), data["id"]))
    return data


def publish_layout(engine, site_id, parent_revision_id, layout):
    """Geometry edits become a new published revision; published revisions stay immutable.

    Returns the published revision record so the caller can pin its id and layout.
    Raises LayoutRejected when TwinForge refuses the geometry; the provider's own
    response body never leaves this adapter.
    """
    try:
        draft = engine.request(f"/v1/sites/{site_id}/revisions", "POST",
                               {"parent_revision_id": parent_revision_id, "layout": layout})
        return engine.request(f"/v1/revisions/{draft['revision_id']}/publish", "POST", version=draft["version"])
    except HTTPError as error:
        if 400 <= error.code < 500:
            raise LayoutRejected from None
        raise


# --- Floor-plan tracing -------------------------------------------------------
# TwinForge traces an owner-supplied drawing into an unconfirmed draft revision.
# SpatialGuard never publishes that draft until the owner has reviewed it.

PLAN_LICENSE = "Private owner-provided floor plan; no redistribution license"
OWNER_ACCEPTED_PLAN = (
    "Traced from an owner-supplied floor-plan drawing and accepted by the site owner in "
    "SpatialGuard. Scale is estimated from the drawing, not measured."
)


def create_site(engine, name):
    return engine.request("/v1/sites", "POST", {"name": name})


def upload_plan(engine, site_id, name, media_type, data_base64):
    return engine.request(f"/v1/sites/{site_id}/assets", "POST", {
        "name": name, "media_type": media_type, "data_base64": data_base64,
        "consent": "owner_approved", "license": PLAN_LICENSE})


def generation_options(engine):
    """Whether the TwinForge server holds a key for vision-assisted tracing."""
    return engine.request("/v1/generation-options")


def trace_plan(engine, site_id, asset_id, ceiling_height_m, vision_assisted=False):
    # vision_assisted sends the drawing to OpenAI from the TwinForge worker. The owner
    # opts in per import; TwinForge falls back to local tracing if the model fails.
    return engine.request(f"/v1/sites/{site_id}/imports", "POST", {
        "kind": "floorplan_raster", "asset_id": asset_id,
        "ceiling_height_m": ceiling_height_m, "vision_assisted": vision_assisted})


def job(engine, job_id):
    return engine.request(f"/v1/jobs/{job_id}")


def delete_site(engine, site_id):
    """Remove a place from TwinForge, taking its revisions and stored drawing with it."""
    engine.request(f"/v1/sites/{site_id}", "DELETE")


def cancel_job(engine, job_id):
    return engine.request(f"/v1/jobs/{job_id}/cancel", "POST", {})


def revision(engine, revision_id):
    return engine.request(f"/v1/revisions/{revision_id}")


# Tracing leaves a space with no readable printed label as "Space 01".
PLACEHOLDER_NAME = re.compile(r"^Space \d+$")


def polygon_area(points):
    """Shoelace area, used only to rank spaces by size."""
    total = 0.0
    for i, (x, y) in enumerate(points):
        nx, ny = points[(i + 1) % len(points)]
        total += x * ny - nx * y
    return abs(total) / 2


def name_largest_room(layout):
    """Call the largest unlabelled space the living room.

    "Space 01" tells an owner nothing. In a home plan the largest space is
    usually the living room, so offer that as a starting name — recorded as a
    guess from relative size, never as something the drawing said. Names the
    tracer actually read from printed labels are left alone.
    """
    unlabelled = [r for r in layout["rooms"] if PLACEHOLDER_NAME.match(r["name"])]
    if not unlabelled:
        return
    largest = max(unlabelled, key=lambda r: polygon_area(r["polygon_xy_m"]))
    largest["name"] = "Living room"
    largest["provenance"]["explanation"] = (
        "Named \"Living room\" because it is the largest unlabelled space; the drawing "
        "did not say so. " + largest["provenance"]["explanation"])[:1000]


def accept_traced(layout):
    """Record the owner's review of traced geometry; the inferred kind is left alone."""
    for entity in layout["rooms"] + layout["zones"] + layout["portals"]:
        provenance = entity["provenance"]
        if not provenance["confirmed"]:
            provenance["confirmed"] = True
            provenance["explanation"] = (
                OWNER_ACCEPTED_PLAN + " Tracer evidence: " + provenance["explanation"])[:1000]


def publish_draft(engine, revision_id, layout, version):
    """Save reviewed geometry onto an existing draft and publish it."""
    try:
        saved = engine.request(f"/v1/revisions/{revision_id}", "PATCH", layout, version=version)
        return engine.request(f"/v1/revisions/{revision_id}/publish", "POST", version=saved["version"])
    except HTTPError as error:
        if 400 <= error.code < 500:
            raise LayoutRejected from None
        raise


class ScaleMismatch(Exception):
    """The owner's two dimensions disagree with the drawing's proportions."""

    def __init__(self, implied_depth_m):
        super().__init__("scale mismatch")
        self.implied_depth_m = implied_depth_m


def plan_extent(layout):
    """Bounding box of the traced footprint as ``(min_x, min_y, width, depth)``."""
    points = [p for area in layout["rooms"] + layout["zones"] for p in area["polygon_xy_m"]]
    if not points:
        return 0.0, 0.0, 0.0, 0.0
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def scale_layout(layout, factor):
    """Scale every horizontal dimension about the origin. Heights are owner-declared."""
    def point(p):
        return [round(p[0] * factor, 4), round(p[1] * factor, 4)]
    for area in layout["rooms"] + layout["zones"]:
        area["polygon_xy_m"] = [point(p) for p in area["polygon_xy_m"]]
    for portal in layout["portals"]:
        portal["segment_xy_m"] = [point(p) for p in portal["segment_xy_m"]]
        portal["width_m"] = round(portal["width_m"] * factor, 4)
    for camera in layout["cameras"]:
        x, y = point(camera["position_m"])
        camera["position_m"] = [x, y, camera["position_m"][2]]
        camera["range_m"] = round(camera["range_m"] * factor, 4)
    plan = layout.get("floor_plan")
    if plan:
        plan["origin_xy_m"] = point(plan["origin_xy_m"])
        plan["width_m"] = round(plan["width_m"] * factor, 4)
        plan["height_m"] = round(plan["height_m"] * factor, 4)


def verify_scale(layout, width_m, depth_m):
    """Rescale traced geometry onto two owner-measured dimensions and record them.

    Tracing only estimates scale from assumed door widths, so metres are not real
    until the owner measures them. The width sets the scale; the depth is an
    independent check. If the drawing's proportions disagree by more than the 2%
    the contract allows, nothing is published and the caller reports it.
    """
    _, _, traced_width, traced_depth = plan_extent(layout)
    if traced_width <= 0 or traced_depth <= 0:
        raise ScaleMismatch(0.0)
    scale_layout(layout, width_m / traced_width)
    min_x, min_y, width, depth = plan_extent(layout)
    if abs(depth - depth_m) / depth_m > 0.02:
        raise ScaleMismatch(round(depth, 2))
    source = "Measured by the site owner in SpatialGuard and applied to the traced drawing"
    # distance_m records what the owner measured; the points are the geometry it
    # was matched against, so TwinForge re-checks the agreement independently.
    layout["scale_anchors"] = [
        {"points": [[min_x, min_y], [min_x + width, min_y]],
         "distance_m": width_m, "source": source + " (overall width)"},
        {"points": [[min_x, min_y], [min_x, min_y + depth]],
         "distance_m": depth_m, "source": source + " (overall depth)"},
    ]
    layout["scale_status"] = "verified"
