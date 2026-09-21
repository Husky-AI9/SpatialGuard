import argparse
import base64
import json
from pathlib import Path
from .store import Store
from .fixture import synthetic_layout, replay, calibration_fixture
from .models import Layout, Observation, CalibrationInput, AssetInput


def main():
    parser = argparse.ArgumentParser(description="TwinForge local administration")
    parser.add_argument(
        "command", choices=["init", "contracts", "fixtures", "demo", "trace-plan"]
    )
    parser.add_argument("image", nargs="?", help="floor-plan image for trace-plan")
    parser.add_argument("--name", help="name for the new place")
    parser.add_argument("--vision", action="store_true", help="send the plan to the configured OpenAI vision model")
    parser.add_argument(
        "--ceiling", type=float, default=2.6, help="assumed ceiling height in metres"
    )
    args = parser.parse_args()
    if args.command == "init":
        store = Store()
        target = store.path.parent / "credentials.json"
        if target.exists():
            print(f"Already initialized. Local credentials: {target.resolve()}")
            return
        credentials = {
            "tenant_id": "tenant_local",
            "owner_token": store.create_membership("tenant_local"),
            "viewer_token": store.create_membership("tenant_local", "viewer"),
        }
        target.write_text(json.dumps(credentials, indent=2), encoding="utf-8")
        print(
            f"Created local owner and viewer credentials at {target.resolve()}. The local launcher opens browser access automatically. Keep this file private."
        )
    if args.command == "contracts":
        target = Path("packages/contracts")
        target.mkdir(parents=True, exist_ok=True)
        for model in (Layout, Observation, CalibrationInput):
            (target / (model.__name__ + ".schema.json")).write_text(
                json.dumps(model.model_json_schema(), indent=2), encoding="utf-8"
            )
        from .api import create_app

        (target / "openapi.json").write_text(
            json.dumps(create_app().openapi(), indent=2), encoding="utf-8"
        )
    if args.command == "fixtures":
        target = Path("fixtures/synthetic-home")
        target.mkdir(parents=True, exist_ok=True)
        values = {
            "layout": synthetic_layout().model_dump(mode="json"),
            "observations": replay("site_fixture", "rev_fixture"),
            "calibration": calibration_fixture(),
        }
        for name, value in values.items():
            (target / (name + ".json")).write_text(
                json.dumps(value, indent=2), encoding="utf-8"
            )
        from PIL import Image, ImageDraw

        image = Image.new("RGB", (960, 720), "white")
        draw = ImageDraw.Draw(image)
        for room in synthetic_layout().rooms:
            points = [(int(x * 80), int(720 - y * 80)) for x, y in room.polygon_xy_m]
            draw.polygon(points, outline="#4b453c", width=3)
            cx = sum(x for x, _ in points) / len(points)
            cy = sum(y for _, y in points) / len(points)
            draw.text((cx, cy), room.name, fill="#4b453c", anchor="mm")
        image.save(target / "floorplan.png")
    if args.command == "demo":
        from .store import uid, now
        from .api import insert_revision

        store = Store()
        credentials = json.loads(
            (store.path.parent / "credentials.json").read_text(encoding="utf-8")
        )
        tenant = credentials["tenant_id"]
        with store.connect() as db:
            exists = db.execute(
                "SELECT id FROM sites WHERE tenant_id=? AND name='Synthetic home'",
                (tenant,),
            ).fetchone()
            if exists:
                print("Synthetic home already exists; no changes made.")
                return
            site = uid("site")
            db.execute(
                "INSERT INTO sites VALUES (?,?,?,?)",
                (site, tenant, "Synthetic home", now()),
            )
            insert_revision(db, tenant, site, synthetic_layout())
        print("Synthetic home draft created. Review and publish it in the viewer.")


    if args.command == "trace-plan":
        trace_plan(args)


def trace_plan(args):
    """Trace a plan image into a reviewable draft without going through HTTP."""
    import io
    from PIL import Image
    from .api import ApiError, sanitize_image, asset_metadata, insert_revision
    from .floorplan import PlanNotReadable, generate_layout
    from .vision_plan import generate_vision_layout
    from .environment import load_environment
    from .geometry import validate_layout
    from .store import uid, now, dump

    if not args.image:
        raise SystemExit("Usage: trace-plan <floor-plan image> [--name NAME]")
    if args.vision:
        load_environment()
    path = Path(args.image)
    data = path.read_bytes()
    media = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    body = AssetInput(
        name=path.name,
        media_type=media,
        data_base64=base64.b64encode(data).decode(),
        consent="owner_approved",
        license="Private operator-provided plan; no redistribution license",
    )
    store = Store()
    credentials = json.loads(
        (store.path.parent / "credentials.json").read_text(encoding="utf-8")
    )
    tenant = credentials["tenant_id"]
    try:
        content, dimensions = sanitize_image(body.name, body.media_type, body.data_base64)
    except ApiError as error:
        raise SystemExit(f"{error.code}: {error.message}")
    with store.connect() as db:
        site = uid("site")
        db.execute(
            "INSERT INTO sites VALUES (?,?,?,?)",
            (site, tenant, args.name or path.stem, now()),
        )
        asset = uid("asset")
        db.execute(
            "INSERT INTO assets VALUES (?,?,?,?,?)",
            (
                asset,
                tenant,
                site,
                dump(asset_metadata(asset, body, content, dimensions)),
                content,
            ),
        )
        try:
            with Image.open(io.BytesIO(content)) as image:
                generator = generate_vision_layout if args.vision else generate_layout
                layout, report = generator(
                    image, asset_id=asset, ceiling_height_m=args.ceiling
                )
        except PlanNotReadable as error:
            raise SystemExit(str(error))
        errors = validate_layout(layout)
        if errors:
            raise SystemExit("The traced geometry failed validation: " + "; ".join(errors))
        revision = insert_revision(db, tenant, site, layout)
    print(json.dumps(report, indent=2))
    print(
        f"Traced {len(layout.rooms)} spaces and {len(layout.portals)} connections into "
        f"a draft ({revision['revision_id']}). Open the viewer, pick "
        f"'{args.name or path.stem}', and review every space before publishing."
    )

if __name__ == "__main__":
    main()
