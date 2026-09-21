"""Durable CPU import worker.

Two import kinds produce geometry: a portable TwinForge bundle, and a traced
raster floor plan. Both land in a draft that a person has to review. Photo
reconstruction stays explicitly unavailable rather than inventing a result.
"""

import argparse
import io
import json
import time
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError
from .store import Store, dump, event, uid, now
from .models import Layout
from .floorplan import generate_layout
from .geometry import canonical_hash, validate_layout
from .vision_plan import generate_vision_layout


def load_bundle(row):
    bundle = json.loads(row["payload"])["bundle"]
    if (
        not bundle
        or bundle.get("format") != "twinforge.bundle"
        or bundle.get("schema_version") != "0.1"
    ):
        raise ValueError("invalid_bundle: expected TwinForge schema 0.1")
    layout = Layout.model_validate(bundle["layout"])
    # Check the exact exported geometry before applying new optional defaults.
    # Older immutable revisions have no pitch_degrees field.
    if canonical_hash(bundle["layout"]) != bundle.get("content_hash"):
        raise ValueError("checksum_mismatch: geometry does not match the bundle hash")
    return layout, {"backend": "bundle_v1"}


def trace_floorplan(store, row):
    """Trace an already-uploaded plan image into unconfirmed draft geometry."""
    payload = json.loads(row["payload"])
    asset_id = payload["asset_id"]
    with store.connect() as db:
        asset = db.execute(
            "SELECT * FROM assets WHERE id=? AND tenant_id=? AND site_id=?",
            (asset_id, row["tenant_id"], row["site_id"]),
        ).fetchone()
    if asset is None:
        raise ValueError("missing_private_asset: the plan image is not in this site")
    try:
        with Image.open(io.BytesIO(asset["content"])) as image:
            image.load()
            generator = generate_vision_layout if payload.get("vision_assisted") else generate_layout
            layout, report = generator(
                image,
                asset_id=asset_id,
                ceiling_height_m=payload.get("ceiling_height_m", 2.6),
            )
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValueError("invalid_image: the stored plan image could not be decoded")
    return layout, report


def run_once(store: Store):
    started = time.time()
    with store.connect() as db:
        db.execute(
            "UPDATE jobs SET state='failed',error='retry_limit',lease_until=NULL WHERE state='running' AND lease_until<? AND attempts>=3",
            (started,),
        )
        row = db.execute(
            "SELECT * FROM jobs WHERE state='queued' OR (state='running' AND lease_until<? AND attempts<3) ORDER BY created_at LIMIT 1",
            (started,),
        ).fetchone()
        if not row:
            return False
        attempt = row["attempts"] + 1
        db.execute(
            "UPDATE jobs SET state='running',attempts=?,lease_until=? WHERE id=?",
            (attempt, started + (600 if json.loads(row["payload"]).get("vision_assisted") else 120), row["id"]),
        )
    try:
        if row["kind"] == "photo_reconstruction":
            raise ValueError(
                "backend_unavailable: COLMAP is not configured; no reconstruction was performed"
            )
        if row["kind"] == "floorplan_raster":
            layout, details = trace_floorplan(store, row)
        else:
            layout, details = load_bundle(row)
        errors = validate_layout(layout)
        if errors:
            raise ValueError("invalid_geometry: " + "; ".join(errors))
        # Referenced private media must already exist in the destination site.
        refs = set(layout.asset_ids)
        if layout.floor_plan:
            refs.add(layout.floor_plan.asset_id)
        for entity in layout.rooms + layout.zones + layout.portals + layout.cameras:
            refs.update(entity.provenance.source_ids)
        with store.connect() as db:
            current = db.execute(
                "SELECT * FROM jobs WHERE id=?", (row["id"],)
            ).fetchone()
            if (
                not current
                or current["state"] != "running"
                or current["attempts"] != attempt
            ):
                return True
            for ref in refs:
                asset = db.execute(
                    "SELECT 1 FROM assets WHERE id=? AND tenant_id=? AND site_id=?",
                    (ref, row["tenant_id"], row["site_id"]),
                ).fetchone()
                if not asset:
                    raise ValueError(
                        "missing_private_asset: portable geometry references media not present in this site"
                    )
            rid = uid("rev")
            db.execute(
                "INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    rid,
                    row["tenant_id"],
                    row["site_id"],
                    None,
                    "draft",
                    1,
                    None,
                    dump(layout.model_dump(mode="json")),
                    now(),
                ),
            )
            output = {
                "revision_id": rid,
                "duration_seconds": time.time() - started,
                "requires_review": True,
                **details,
            }
            db.execute(
                "UPDATE jobs SET state='needs_review',output=?,lease_until=NULL WHERE id=?",
                (dump(output), row["id"]),
            )
            event(db, row["tenant_id"], row["site_id"], "import.needs_review", output)
    except (ValueError, KeyError, TypeError, ValidationError) as exc:
        with store.connect() as db:
            db.execute(
                "UPDATE jobs SET state='failed',error=?,lease_until=NULL WHERE id=? AND state='running' AND attempts=?",
                (str(exc)[:1500], row["id"], attempt),
            )
    return True


def main():
    from .environment import load_environment
    load_environment()
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    store = Store()
    while True:
        worked = run_once(store)
        if args.once:
            break
        if not worked:
            time.sleep(1)


if __name__ == "__main__":
    main()
