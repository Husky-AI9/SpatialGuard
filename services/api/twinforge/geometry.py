"""All spatial math uses X-right/Y-forward/Z-up in meters."""

from collections import deque
import hashlib
import json
import math
import numpy as np
from shapely.geometry import Polygon, Point, LineString, MultiPoint
from .models import Layout, PointQuery, GraphQuery, CalibrationInput


def canonical_hash(value):
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


def world_to_viewer(p):
    x, y, z = p
    return [x, z, -y]


def viewer_to_world(p):
    x, y, z = p
    return [x, -z, y]


def camera_center_from_colmap(rotation, translation):
    return (-np.asarray(rotation).T @ np.asarray(translation)).tolist()


def validate_layout(layout: Layout, publishing=False):
    issues = []
    entities = (
        layout.floors + layout.rooms + layout.zones + layout.portals + layout.cameras
    )
    ids = [o.id for o in entities]
    if len(ids) != len(set(ids)):
        issues.append("Entity IDs must be unique within the revision")
    floor_ids = {f.id for f in layout.floors}
    polygons = {}
    for r in layout.rooms + layout.zones:
        poly = Polygon(r.polygon_xy_m)
        if not poly.is_valid or poly.area < 0.01:
            issues.append(f"{r.id}: polygon self-intersects or has negligible area")
        else:
            polygons[r.id] = poly
        if r.floor_id not in floor_ids:
            issues.append(f"{r.id}: floor does not exist")
        if publishing and not r.provenance.confirmed:
            issues.append(f"{r.id}: confirm geometry before publishing")
    for i, a in enumerate(layout.rooms):
        for b in layout.rooms[i + 1 :]:
            if (
                a.id in polygons
                and b.id in polygons
                and polygons[a.id].intersection(polygons[b.id]).area > 1e-6
            ):
                issues.append(f"{a.id} and {b.id}: rooms overlap")
    rooms = {r.id: r for r in layout.rooms}
    for portal in layout.portals:
        a, b = portal.from_room_id, portal.to_room_id
        if a not in rooms or b not in rooms or a == b:
            issues.append(f"{portal.id}: requires two different existing rooms")
            continue
        line = LineString(portal.segment_xy_m)
        if line.length < 0.05 or abs(line.length - portal.width_m) > 0.05:
            issues.append(
                f"{portal.id}: width must agree with its segment (within 5 cm)"
            )
        for rid in (a, b):
            if rid in polygons and not polygons[rid].boundary.buffer(0.06).covers(line):
                issues.append(
                    f"{portal.id}: segment must lie on both connected room boundaries"
                )
        if publishing and not portal.provenance.confirmed:
            issues.append(f"{portal.id}: portal needs review")
    for c in layout.cameras:
        if c.floor_id not in floor_ids:
            issues.append(f"{c.id}: floor does not exist")
        if publishing and not c.provenance.confirmed:
            issues.append(f"{c.id}: camera placement needs review")
    if layout.scale_status == "verified":
        anchors = layout.scale_anchors
        if len(anchors) < 2:
            issues.append("Verified scale requires two independent dimensions")
        for a in anchors:
            length = math.dist(*a.points)
            if abs(length - a.distance_m) / a.distance_m > 0.02:
                issues.append("Scale anchor differs from geometry by more than 2%")
        if len(anchors) >= 2:
            vectors = [np.subtract(a.points[1], a.points[0]) for a in anchors]
            # An independent check must not repeat a collinear measurement.
            if all(
                abs(float(np.linalg.det(np.array([vectors[0], v])))) < 1e-6
                for v in vectors[1:]
            ):
                issues.append("Scale anchors must measure independent directions")
    if publishing:
        if not layout.rooms:
            issues.append("At least one room is required")
        if layout.scale_status != "verified":
            issues.append("Verify metric scale before publishing")
    return issues


def query_layout(layout: Layout, q):
    if isinstance(q, PointQuery):
        if q.floor_id not in {f.id for f in layout.floors}:
            raise ValueError("Unknown floor")
        p = Point(q.xy_m)
        if q.kind == "visibility":
            cameras = []
            for c in layout.cameras:
                dx, dy = q.xy_m[0] - c.position_m[0], q.xy_m[1] - c.position_m[1]
                angle = (
                    math.degrees(math.atan2(dy, dx)) - c.heading_degrees + 180
                ) % 360 - 180
                if (
                    c.floor_id == q.floor_id
                    and math.hypot(dx, dy) <= c.range_m
                    and abs(angle) <= c.fov_degrees / 2
                ):
                    cameras.append(c.id)
            return {
                "camera_ids": cameras,
                "quality": "approximate",
                "reason": "Field-of-view estimate; walls and occlusions are not evaluated",
            }
        collection = layout.rooms if q.kind == "room" else layout.zones
        matches, candidates = [], []
        disk = p.buffer(q.uncertainty_radius_m) if q.uncertainty_radius_m else p
        for r in collection:
            if r.floor_id != q.floor_id:
                continue
            poly = Polygon(r.polygon_xy_m)
            if poly.intersects(disk):
                candidates.append(r.id)
            if poly.covers(disk):
                matches.append(r.id)
        ambiguous = q.kind == "room" and len(matches) != 1
        return {
            "ids": [] if ambiguous else matches,
            "candidate_ids": candidates,
            "quality": "unknown" if ambiguous or not matches else "assigned",
            "reason": (
                "Boundary or uncertainty overlaps spaces"
                if ambiguous
                else "Polygon containment"
            ),
        }
    room_ids = {r.id for r in layout.rooms}
    if q.from_room_id not in room_ids or (
        q.to_room_id and q.to_room_id not in room_ids
    ):
        raise ValueError("Unknown room")
    adjacency = []
    graph = {r: [] for r in room_ids}
    excluded = []
    for p in layout.portals:
        if q.from_room_id in (p.from_room_id, p.to_room_id):
            adjacency.append(
                {
                    "portal_id": p.id,
                    "room_id": (
                        p.to_room_id
                        if p.from_room_id == q.from_room_id
                        else p.from_room_id
                    ),
                }
            )
        state = p.state
        age = (
            (q.assumptions.at - p.state_observed_at).total_seconds()
            if p.state_observed_at
            else None
        )
        if age is None or age < 0 or age > q.assumptions.maximum_state_age_seconds:
            state = "unknown"
        reason = None
        if not p.provenance.confirmed or not all(
            r.provenance.confirmed
            for r in layout.rooms
            if r.id in (p.from_room_id, p.to_room_id)
        ):
            reason = "unconfirmed geometry"
        elif p.width_m < q.assumptions.minimum_clearance_m:
            reason = "insufficient clearance"
        elif state == "closed":
            reason = "closed"
        elif state == "unknown" and q.assumptions.unknown_portals == "exclude":
            reason = "unknown or stale state"
        if reason:
            excluded.append({"portal_id": p.id, "reason": reason})
        else:
            graph[p.from_room_id].append((p.to_room_id, p.id))
            graph[p.to_room_id].append((p.from_room_id, p.id))
    base = {"assumptions": q.assumptions.model_dump(mode="json"), "excluded": excluded}
    if q.kind == "adjacency":
        return {
            **base,
            "adjacent": adjacency,
            "note": "Adjacency does not imply traversability",
        }
    if not q.to_room_id:
        raise ValueError("Path requires to_room_id")
    queue = deque([(q.from_room_id, [q.from_room_id], [])])
    seen = {q.from_room_id}
    while queue:
        current, rooms, portals = queue.popleft()
        if current == q.to_room_id:
            return {**base, "available": True, "room_ids": rooms, "portal_ids": portals}
        for neighbor, portal in graph[current]:
            if neighbor not in seen:
                seen.add(neighbor)
                queue.append((neighbor, rooms + [neighbor], portals + [portal]))
    return {
        **base,
        "available": False,
        "room_ids": [],
        "portal_ids": [],
        "reason": "No path under the stated assumptions",
    }


def project(h, xy):
    v = np.asarray(h) @ np.array([*xy, 1.0])
    if abs(v[2]) < 1e-8:
        raise ValueError("Projection is near the horizon")
    result = v[:2] / v[2]
    if not np.isfinite(result).all() or np.linalg.norm(result) > 1e5:
        raise ValueError("Unstable projection")
    return result.tolist()


def fit_calibration(c: CalibrationInput):
    train = {tuple(p.image_xy) for p in c.image_points}
    if any(tuple(p.image_xy) in train for p in c.holdout_points):
        raise ValueError("Holdout points must be independent of calibration points")
    src = np.asarray([p.image_xy for p in c.image_points], dtype=float)
    dst = np.asarray([p.floor_xy_m for p in c.image_points], dtype=float)

    def normalize(points):
        center = points.mean(axis=0)
        scale = np.sqrt(2) / max(np.linalg.norm(points - center, axis=1).mean(), 1e-12)
        t = np.array(
            [[scale, 0, -scale * center[0]], [0, scale, -scale * center[1]], [0, 0, 1]]
        )
        return np.column_stack([points, np.ones(len(points))]) @ t.T, t

    a, ta = normalize(src)
    b, tb = normalize(dst)
    rows = []
    for (x, y, _), (u, v, _) in zip(a, b):
        rows += [
            [-x, -y, -1, 0, 0, 0, u * x, u * y, u],
            [0, 0, 0, -x, -y, -1, v * x, v * y, v],
        ]
    matrix = np.asarray(rows)
    if np.linalg.matrix_rank(matrix) < 8 or MultiPoint(src).convex_hull.area < 100:
        raise ValueError("Degenerate or poorly spread calibration points")
    _, _, vh = np.linalg.svd(matrix)
    h = np.linalg.inv(tb) @ vh[-1].reshape(3, 3) @ ta
    if abs(h[2, 2]) < 1e-10 or np.linalg.cond(h) > 1e9:
        raise ValueError("Unstable homography")
    h /= h[2, 2]
    hull = MultiPoint(src).convex_hull
    denominators = [float((h @ [x, y, 1])[2]) for x, y in hull.exterior.coords]
    if min(denominators) <= 1e-6:
        raise ValueError("Calibrated region crosses unstable horizon geometry")
    for p in c.image_points + c.holdout_points:
        if not (
            0 <= p.image_xy[0] < c.resolution[0]
            and 0 <= p.image_xy[1] < c.resolution[1]
        ):
            raise ValueError("Point is outside the declared image resolution")
    if any(not hull.covers(Point(p.image_xy)) for p in c.holdout_points):
        raise ValueError("Holdout points must lie in the calibrated region")
    errors = [math.dist(project(h, p.image_xy), p.floor_xy_m) for p in c.holdout_points]
    median, p95 = float(np.median(errors)), float(np.percentile(errors, 95))
    return {
        "homography": h.tolist(),
        "image_region": list(hull.exterior.coords),
        "quality": (
            "accepted" if c.reviewed and median <= 0.5 and p95 <= 1 else "degraded"
        ),
        "report": {
            "median_error_m": median,
            "p95_error_m": p95,
            "holdout_count": len(errors),
            "training_count": len(src),
            "algorithm": "normalized_dlt_v1",
            "evidence": "User-supplied independent correspondences; not a probability",
        },
    }
