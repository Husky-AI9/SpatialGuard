"""Synthetic-only geometry and replay. No real address, media, or identities."""

from .models import Layout

P = {
    "kind": "manual",
    "source_ids": [],
    "confirmed": True,
    "explanation": "Authored synthetic fixture; dimensions are defined, not a real-world measurement.",
}


def rectangle(x, y, w, h):
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]


def synthetic_layout():
    rooms = [
        ("living", "Living room", 0, 0, 4, 4),
        ("kitchen", "Kitchen", 4, 0, 4, 4),
        ("hall", "Hallway", 0, 4, 8, 1.5),
        ("study", "Study", 0, 5.5, 4, 3),
        ("approach", "Front approach", 8, 4, 3, 1.5),
    ]
    portals = [
        ("living_hall", "Living doorway", "living", "hall", [[2.8, 4], [3.8, 4]]),
        ("kitchen_hall", "Kitchen doorway", "kitchen", "hall", [[5, 4], [6, 4]]),
        ("study_hall", "Study doorway", "study", "hall", [[2.8, 5.5], [3.8, 5.5]]),
        ("entry", "Front door", "hall", "approach", [[8, 4.2], [8, 5.2]]),
    ]
    return Layout.model_validate(
        {
            "scale_status": "verified",
            "scale_anchors": [
                {
                    "points": [[0, 0], [8, 0]],
                    "distance_m": 8,
                    "source": "Synthetic horizontal dimension",
                },
                {
                    "points": [[0, 0], [0, 8.5]],
                    "distance_m": 8.5,
                    "source": "Synthetic vertical check",
                },
            ],
            "floors": [{"id": "floor_0", "name": "Ground floor", "elevation_m": 0}],
            "rooms": [
                {
                    "id": "room_" + i,
                    "name": name,
                    "floor_id": "floor_0",
                    "polygon_xy_m": rectangle(x, y, w, h),
                    "height_m": 2.6 if i != "approach" else 0.15,
                    "provenance": P,
                }
                for i, name, x, y, w, h in rooms
            ],
            "zones": [
                {
                    "id": "zone_entry",
                    "name": "Entry zone",
                    "floor_id": "floor_0",
                    "purpose": "entry",
                    "polygon_xy_m": rectangle(6, 4, 2, 1.5),
                    "provenance": P,
                }
            ],
            "portals": [
                {
                    "id": "portal_" + i,
                    "name": name,
                    "from_room_id": "room_" + a,
                    "to_room_id": "room_" + b,
                    "segment_xy_m": points,
                    "width_m": 1,
                    "state": "unknown",
                    "provenance": P,
                }
                for i, name, a, b, points in portals
            ],
            "cameras": [
                {
                    "id": "camera_front",
                    "name": "Front camera",
                    "floor_id": "floor_0",
                    "position_m": [8.2, 5.3, 2.2],
                    "heading_degrees": -25,
                    "fov_degrees": 70,
                    "range_m": 3.2,
                    "configuration_hash": "synthetic-front-v1",
                    "provenance": P,
                },
                {
                    "id": "camera_hall",
                    "name": "Hallway camera",
                    "floor_id": "floor_0",
                    "position_m": [0.3, 4.8, 2.2],
                    "heading_degrees": 0,
                    "fov_degrees": 65,
                    "range_m": 7.3,
                    "configuration_hash": "synthetic-hall-v1",
                    "provenance": P,
                },
            ],
        }
    )


def replay(site, revision):
    points = [
        (10.3, 4.8),
        (9.7, 4.8),
        (9.1, 4.8),
        (8.5, 4.8),
        None,
        (7.3, 4.8),
        (6.3, 4.8),
        (5.3, 4.8),
        (4.3, 4.8),
        (3.3, 4.8),
        None,
        (3.3, 3.4),
    ]
    return [
        {
            "schema_version": "0.1",
            "observation_id": f"{revision}_replay_{i:03}",
            "site_id": site,
            "revision_id": revision,
            "source_id": "camera_front" if i < 5 else "camera_hall",
            "observed_at": f"2026-09-13T18:00:{i*3:02}Z",
            "received_at": f"2026-09-13T18:00:{i*3+1:02}Z",
            "category": "person",
            "location": (
                {
                    "kind": "floor_point",
                    "floor_id": "floor_0",
                    "xy_m": point,
                    "uncertainty_radius_m": 0.25,
                }
                if point
                else {
                    "kind": "unknown",
                    "reason": "Synthetic coverage gap; no coordinate evidence",
                }
            ),
            "evidence": {"mode": "replay"},
            "provenance": {
                "kind": "inferred",
                "source_ids": [],
                "confirmed": False,
                "explanation": "Deterministic synthetic replay location, not camera inference",
            },
        }
        for i, point in enumerate(points)
    ]


def calibration_fixture():
    def pair(x, y):
        return {"image_xy": [x, y], "floor_xy_m": [x / 100, 4 + y / 1000]}

    return {
        "camera_id": "camera_hall",
        "configuration_hash": "synthetic-hall-v1",
        "resolution": [800, 1500],
        "image_space": "undistorted",
        "image_points": [
            pair(50, 100),
            pair(750, 100),
            pair(750, 1400),
            pair(50, 1400),
            pair(400, 100),
            pair(400, 1400),
        ],
        "holdout_points": [
            pair(150, 300),
            pair(350, 700),
            pair(600, 1100),
            pair(500, 400),
        ],
        "reviewed": True,
    }
