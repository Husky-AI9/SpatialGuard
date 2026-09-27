"""Wall-first tracing for crisp architectural floor plans.

Most published plans draw structure with one convention: walls are thick solid
black bands, doors and windows are thin lines (a leaf and a swing arc for a
door), and open edges such as porches are dashed. This module reads that
convention directly from pixels, so room geometry is measured from the drawing
instead of estimated. It returns ``PlanNotReadable`` for drawings that do not
follow the convention, and callers fall back to the general tracer.

Room names and printed dimensions are *not* read here; ``build_layout`` accepts
them from any label reader (the vision adapter supplies them) and uses printed
dimensions to set the metric scale.
"""

import math
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image
from shapely.geometry import LineString, Point, Polygon

from .floorplan import MAX_PORTALS, MAX_ROOMS, PlanNotReadable, cluster_axis, tidy_polygon
from .models import Floor, FloorPlanImage, Layout, Portal, Provenance, Room, Zone

WORKING_LONG_SIDE = 2400
# Wall bands narrower than this (in working pixels) cannot be told apart from
# door leaves and fixture outlines reliably.
MIN_WALL_PX = 9
# An exterior wall is drawn roughly 0.15 m thick on residential plans. Used only
# when neither printed dimensions nor door openings give a scale.
ASSUMED_WALL_M = 0.15
# The traced gap is the clear opening between wall ends, narrower than the
# nominal door: a 2'8" (0.81 m) interior door leaves about 0.72 m.
ASSUMED_DOOR_GAP_M = 0.72


@dataclass
class Label:
    """A printed room label: where it sits and the dimensions printed with it."""
    name: str
    x: float  # 0..1 across the image
    y: float  # 0..1 down the image
    kind: str = "room"  # "room" or "outdoor"
    width_m: float | None = None
    depth_m: float | None = None


@dataclass
class WallTrace:
    shape: tuple[int, int]            # working (height, width)
    factor: float                     # working px per source px
    wall_px: int
    rooms: np.ndarray                 # int32 labels, 0 = not a room, tiles the footprint
    clear: dict[int, tuple[int, int, int, int]]  # room -> clear-space bbox (x, y, w, h)
    doors: list[dict] = field(default_factory=list)
    outdoor: list[np.ndarray] = field(default_factory=list)


def _runs(mask, step):
    lengths = []
    for arr in (mask, mask.T):
        for row in arr[::step]:
            edges = np.diff(np.concatenate(([0], row, [0])).astype(np.int8))
            lengths.append(np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1))
    return np.concatenate(lengths) if lengths else np.array([], int)


def _close(mask, kernel):
    """Morphological closing that treats everything beyond the page as empty.

    OpenCV erodes with an infinite border, so a large closing near the page
    edge would otherwise fill the margin and seal the building to the border.
    """
    ky, kx = kernel
    padded = cv2.copyMakeBorder(mask, ky, ky, kx, kx, cv2.BORDER_CONSTANT, value=0)
    closed = cv2.morphologyEx(padded, cv2.MORPH_CLOSE, np.ones((ky, kx), np.uint8))
    return closed[ky:-ky, kx:-kx]


def _components(mask, connectivity=4):
    count, labels = cv2.connectedComponents(mask.astype(np.uint8), connectivity=connectivity)
    return count, labels


def trace(image):
    """Segment a plan into rooms, doors and outdoor pockets, in working pixels."""
    gray = image.convert("L")
    # Never enlarge: thin bands in a small drawing are not reliably walls.
    factor = min(1.0, WORKING_LONG_SIDE / max(gray.size))
    if abs(factor - 1) > 0.05:
        gray = gray.resize((round(gray.width * factor), round(gray.height * factor)), Image.LANCZOS)
    else:
        factor = 1.0
    gray = np.asarray(gray)
    height, width = gray.shape
    ink = (gray < 110).astype(np.uint8)
    # Thin strokes turn grey when the drawing is resampled; read them lighter.
    lines = (gray < 200).astype(np.uint8)
    faint = (gray < 235).astype(np.uint8)  # dashed open edges are often light grey
    if not 0.01 < ink.mean() < 0.4:
        raise PlanNotReadable("not_wall_plan: ink coverage does not match a line drawing")

    # 1. Wall thickness is the most common solid run clearly thicker than a line.
    runs = _runs(ink, 5)
    thin = int(np.median(runs[runs <= 8])) if (runs <= 8).any() else 2
    thick = runs[(runs >= max(MIN_WALL_PX, thin * 3)) & (runs <= max(height, width) // 25)]
    if len(thick) < 50:
        raise PlanNotReadable("not_wall_plan: no solid wall bands were found")
    histogram = np.bincount(thick)
    wall_px = int(np.argmax(histogram))
    # Interior partitions are often thinner than exterior walls: keep anything at
    # least half the dominant band so both survive.
    core = max(3, int(wall_px * 0.5))

    # 2. Walls: ink that survives an opening by a fraction of the band width.
    # Door leaves, arcs, window lines, dashes, text and fixtures are removed.
    walls = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((core, core), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(walls, 8)
    keep = np.zeros(count, bool)
    # Large lettering survives the opening too, but no glyph is five bands long.
    keep[1:] = np.maximum(stats[1:, 2], stats[1:, 3]) >= wall_px * 5
    walls = keep[labels].astype(np.uint8)
    if walls.sum() < wall_px * max(height, width):
        raise PlanNotReadable("not_wall_plan: too little solid wall to trace")

    # 3. Axis pieces. A horizontal piece is wall at least a band-and-a-bit long in
    # x, so vertical walls (one band wide) never join horizontal bridges.
    long_k = wall_px + max(4, wall_px // 5)
    horiz = cv2.morphologyEx(walls, cv2.MORPH_OPEN, np.ones((1, long_k), np.uint8))
    vert = cv2.morphologyEx(walls, cv2.MORPH_OPEN, np.ones((long_k, 1), np.uint8))

    # 4. Building footprint. Exterior windows and doors are gaps in collinear
    # walls; bridge them generously along their own axis, then anything the
    # page border cannot reach without crossing ink is inside the building.
    wide = wall_px * 14
    envelope = walls | lines
    envelope |= _close(horiz, (1, wide))
    envelope |= _close(vert, (wide, 1))
    # Doors beside a corner and diagonal walls have no collinear partner; a
    # door-sized closing seals them. Only the outer outline uses this mask.
    envelope |= _close(walls, (wall_px * 12,) * 2)
    envelope = cv2.dilate(envelope, np.ones((3, 3), np.uint8))
    count, labels = _components(1 - envelope)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    exterior = np.isin(labels, border[border > 0])  # label 0 is the ink itself
    contours, _ = cv2.findContours((~exterior).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise PlanNotReadable("no_enclosed_outline: the drawing has no closed building outline")
    footprint = np.zeros((height, width), np.uint8)
    biggest = max(cv2.contourArea(c) for c in contours)
    cv2.drawContours(footprint, [c for c in contours if cv2.contourArea(c) >= biggest * 0.05], -1, 1, cv2.FILLED)
    if footprint.sum() < 0.03 * height * width:
        raise PlanNotReadable("no_enclosed_outline: the enclosed outline is too small")

    # 5. Door gaps. Bridge collinear wall ends up to a door-and-a-half apart, and
    # keep a bridge only when the drawing marks it: a swing arc or leaf beside it,
    # or thin lines (sliding doors, dashed openings) across it. A corridor between
    # two parallel walls is never closed because its walls run the other way.
    symbols = lines & ~cv2.dilate(walls, np.ones((5, 5), np.uint8))
    reach = wall_px * 7
    doors, barrier = [], walls.copy()
    for axis, pieces, kernel in ((0, horiz, (1, reach)), (1, vert, (reach, 1))):
        bridged = _close(pieces, kernel) & ~walls & footprint
        count, labels, stats, _ = cv2.connectedComponentsWithStats(bridged.astype(np.uint8), 4)
        for i in range(1, count):
            x, y, w, h, area = stats[i]
            length, depth = (w, h) if axis == 0 else (h, w)
            if length < wall_px * 1.5 or depth < core:
                continue
            if axis == 0:
                cy = y + h // 2
                across = faint[y:y + h, x:x + w].max(axis=0).mean()
                sides = [symbols[max(0, y - length):y, x:x + w], symbols[y + h:y + h + length, x:x + w]]
                segment = ((x, cy), (x + w, cy))
            else:
                cx = x + w // 2
                across = faint[y:y + h, x:x + w].max(axis=1).mean()
                sides = [symbols[y:y + h, max(0, x - length):x], symbols[y:y + h, x + w:x + w + length]]
                segment = ((cx, y), (cx, y + h))
            swing = max((side.mean() for side in sides if side.size), default=0)
            if across < 0.2 and swing < 0.012:
                continue
            barrier[labels == i] = 1
            doors.append({"segment": segment, "length_px": float(length), "axis": axis})

    # Dashed open edges are drawn on the wall faces, so the whole bridge band is
    # checked for faint marks above, not just its centre line.
    # 6. Rooms: connected clear space inside the footprint.
    # Shave one wall band off the outline so rooms cannot connect through a
    # window gap along the outside face of the building.
    shell = cv2.erode(footprint, np.ones((wall_px, wall_px), np.uint8))
    free = shell & (1 - barrier)
    free = cv2.morphologyEx(free, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(free, 4)
    min_area = (wall_px * 2.5) ** 2
    order = [i for i in range(1, count) if stats[i, 4] >= min_area]
    order.sort(key=lambda i: -stats[i, 4])
    if len(order) < 2:
        raise PlanNotReadable("no_spaces_found: walls did not divide the plan into rooms")
    order = order[:MAX_ROOMS]
    markers = np.zeros((height, width), np.int32)
    for number, i in enumerate(order, 1):
        markers[labels == i] = number

    # 7. Grow rooms through their walls so neighbours meet on the wall centre
    # line and together tile the whole footprint.
    markers[footprint == 0] = len(order) + 1
    flat = np.zeros((height, width, 3), np.uint8)
    cv2.watershed(flat, markers)
    rooms = markers.copy()
    rooms[(rooms > len(order)) | (footprint == 0)] = 0
    # Watershed leaves one-pixel ridges (-1); hand each to a neighbouring room.
    ridge = rooms < 0
    rooms[ridge] = 0
    grown = cv2.dilate(rooms.astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.int32)
    rooms[ridge & (footprint > 0)] = grown[ridge & (footprint > 0)]
    # Printed dimensions are clear sizes: the room without its wall bands.
    clear = {}
    for number in range(1, len(order) + 1):
        ys, xs = np.nonzero((rooms == number) & (barrier == 0))
        if xs.size:
            clear[number] = (int(xs.min()), int(ys.min()), int(np.ptp(xs)) + 1, int(np.ptp(ys)) + 1)

    # 8. Outdoor pockets: areas outside the footprint closed off by dashed edges,
    # posts and thin lines (porches, patios). Named later only when a label says so.
    dash = cv2.dilate(lines, np.ones((max(5, wall_px),) * 2, np.uint8)) | cv2.dilate(footprint, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats((1 - dash).astype(np.uint8), 4)
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist()) | {0}
    outdoor = [labels == i for i in range(1, count)
               if i not in border and stats[i, 4] >= (wall_px * 6) ** 2]
    return WallTrace((height, width), factor, wall_px, rooms, clear, doors, outdoor)


# --------------------------------------------------------------------------- #
# Scale
# --------------------------------------------------------------------------- #


def room_at(result, label, radius_px=None):
    """The room under a label point, or the nearest room within a short radius."""
    height, width = result.shape
    x, y = int(label.x * width), int(label.y * height)
    if not (0 <= x < width and 0 <= y < height):
        return 0
    if result.rooms[y, x] > 0:
        return int(result.rooms[y, x])
    radius = radius_px or result.wall_px * 3
    window = result.rooms[max(0, y - radius):y + radius, max(0, x - radius):x + radius]
    values = window[window > 0]
    return int(np.bincount(values).argmax()) if values.size else 0


def printed_scale(result, labels):
    """Metres per working pixel from printed room dimensions, or None.

    Printed dimensions are clear interior sizes. A traced room is often bigger
    than its printed size along one side (a closet or entry nook without its own
    door joins it), so each label votes with every side it could match, and the
    scale most labels agree on wins. Returns ``(scale, labels_agreeing)``.
    """
    votes = []  # (px per metre, label index)
    for index, label in enumerate(labels):
        if label.kind != "room" or not label.width_m or not label.depth_m:
            continue
        room = room_at(result, label)
        if room not in result.clear:
            continue
        _, _, w, h = result.clear[room]
        votes += [(size / printed, index) for size in (w, h) for printed in (label.width_m, label.depth_m)]
    best, best_key = None, (0, 0)
    for candidate, _ in votes:
        near = [(value, index) for value, index in votes if abs(value / candidate - 1) <= 0.04]
        key = (len({index for _, index in near}), len(near))
        if key > best_key:
            best, best_key = near, key
    if not best or best_key[0] < 2:
        return None, 0
    return 1 / float(np.median([value for value, _ in best])), best_key[0]


# --------------------------------------------------------------------------- #
# Layout assembly
# --------------------------------------------------------------------------- #


def _outline(mask, eps):
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    return [tuple(map(float, p[0])) for p in cv2.approxPolyDP(contour, eps, True)]


def _largest(geometry):
    if geometry.is_empty:
        return None
    if geometry.geom_type == "Polygon":
        return geometry
    polygons = [g for g in getattr(geometry, "geoms", []) if g.geom_type == "Polygon"]
    return max(polygons, key=lambda g: g.area) if polygons else None


def _door_sides(result, door):
    """The rooms on either side of a door, walking out from its centre line."""
    height, width = result.shape
    (x1, y1), (x2, y2) = door["segment"]
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    sides = []
    for sign in (-1, 1):
        for step in range(max(2, result.wall_px // 2), result.wall_px * 4, 2):
            px, py = (cx, cy + sign * step) if door["axis"] == 0 else (cx + sign * step, cy)
            if not (0 <= px < width and 0 <= py < height):
                break
            room = int(result.rooms[py, px])
            if room > 0:
                sides.append(room)
                break
    return sides


def _portal_segment(a, b, requested, tolerance=0.05):
    """A door segment lying on both room boundaries, or None.

    The traced gap runs down the middle of the wall, which is where the two
    rooms meet, so it is used as drawn when both boundaries carry it. Otherwise
    it is projected onto the stretch of boundary the rooms share.
    """
    def carried(line):
        return all(p.boundary.buffer(tolerance).covers(line) for p in (a, b))
    for candidate in (requested, LineString([a.exterior.interpolate(a.exterior.project(Point(c)))
                                             for c in requested.coords])):
        if candidate.length >= 0.3 and carried(candidate):
            return [(round(x, 4), round(y, 4)) for x, y in candidate.coords]
    shared = a.boundary.intersection(b.buffer(0.02)).intersection(b.boundary.buffer(0.06))
    pieces = [g for g in ([shared] if shared.geom_type == "LineString" else getattr(shared, "geoms", []))
              if g.geom_type == "LineString" and g.length > 0.05]
    if not pieces:
        return None
    line = min(pieces, key=lambda g: g.distance(requested.centroid))
    ends = [line.interpolate(line.project(Point(p))) for p in requested.coords]
    candidate = LineString(ends)
    if candidate.length < 0.3 or not carried(candidate):
        return None
    return [(round(p.x, 4), round(p.y, 4)) for p in ends]


def build_layout(result, *, labels=(), asset_id=None, ceiling_height_m=2.6,
                 floor_name="Ground floor (traced from plan)", label_reader="none"):
    """Turn a :class:`WallTrace` into a reviewable, unconfirmed layout."""
    height, width = result.shape
    scale, dimensioned = printed_scale(result, labels)
    if scale:
        basis = (f"printed dimensions of {dimensioned} rooms matched to their traced "
                 "clear sizes")
    elif result.doors:
        spans = sorted(d["length_px"] for d in result.doors)
        scale = ASSUMED_DOOR_GAP_M / spans[len(spans) // 2]
        basis = (f"{len(spans)} door openings, typical clear gap assumed {ASSUMED_DOOR_GAP_M:g} m; "
                 "no printed dimensions were read")
    else:
        scale = ASSUMED_WALL_M / result.wall_px
        basis = f"wall bands assumed {ASSUMED_WALL_M:g} m thick; no doors or dimensions were read"

    names = {}
    for label in labels:
        room = room_at(result, label) if label.kind == "room" else 0
        if room and label.name not in names.setdefault(room, []):
            names[room].append(label.name)

    # Outlines in pixels, snapped to shared axis lines so walls stay straight
    # and neighbours share coordinates.
    eps = max(1.5, result.wall_px * 0.2)
    loops = {}
    for number in range(1, int(result.rooms.max()) + 1):
        mask = result.rooms == number
        if mask.any():
            loop = _outline(mask, eps)
            if len(loop) >= 3:
                loops[number] = loop
    tolerance = result.wall_px * 0.45
    snap_x = cluster_axis([p[0] for loop in loops.values() for p in loop], tolerance)
    snap_y = cluster_axis([p[1] for loop in loops.values() for p in loop], tolerance)

    def metres(point):
        return (round(point[0] * scale, 4), round((height - point[1]) * scale, 4))

    polygons, claimed = {}, None
    for number in sorted(loops, key=lambda n: -int((result.rooms == n).sum())):
        points = tidy_polygon([metres((snap_x[x], snap_y[y])) for x, y in loops[number]])
        if len(points) < 3:
            continue
        polygon = _largest(Polygon(points).buffer(0))
        if polygon is None:
            continue
        polygon = polygon.simplify(0.01, preserve_topology=True)
        if claimed is not None:
            # Rounding to the output precision must not reintroduce overlap.
            polygon = _largest(polygon.difference(claimed.buffer(0.0005)))
        if polygon is None or polygon.area < 0.25:
            continue
        polygons[number] = polygon
        claimed = polygon if claimed is None else claimed.union(polygon)

    def provenance(detail):
        return Provenance(kind="inferred", confirmed=False, source_ids=[asset_id] if asset_id else [],
            explanation=("Traced from the solid wall bands of a floor-plan drawing. " + detail +
                         f" Scale: {basis}. Ceiling height assumed {ceiling_height_m:g} m. "
                         "Review against the real building before publishing.")[:1000])

    # Slivers at a garage door or bay window are not rooms: keep a small space
    # only when a label or a drawn door says it is one (closets, pantries).
    doored = {side for door in result.doors for side in _door_sides(result, door)}
    polygons = {n: p for n, p in polygons.items() if p.area >= 1.0 or n in names or n in doored}

    rooms, ids = [], {}
    for index, (number, polygon) in enumerate(sorted(polygons.items(), key=lambda item: (
            -item[1].bounds[3], item[1].bounds[0])), 1):
        name = " / ".join(names.get(number, []))[:100] or f"Space {index:02d}"
        identifier = f"space_{index:02d}"
        ids[number] = identifier
        coords = [(round(x, 4), round(y, 4)) for x, y in list(polygon.exterior.coords)[:-1]]
        rooms.append(Room(id=identifier, floor_id="floor_0", name=name, polygon_xy_m=coords,
            height_m=ceiling_height_m, provenance=provenance(
                "The name repeats the printed label." if number in names else
                "No printed label was matched, so the name is a placeholder.")))
    if len(rooms) < 2:
        raise PlanNotReadable("no_spaces_found: fewer than two rooms survived geometry checks")

    portals = []
    for door in result.doors:
        (x1, y1), (x2, y2) = door["segment"]
        sides = _door_sides(result, door)
        if len(sides) != 2 or sides[0] == sides[1] or not all(s in ids for s in sides):
            continue
        a, b = polygons[sides[0]], polygons[sides[1]]
        requested = LineString([metres((x1, y1)), metres((x2, y2))])
        segment = _portal_segment(a, b, requested)
        if segment is None:
            continue
        length = LineString(segment).length
        portals.append(Portal(id=f"door_{len(portals) + 1:02d}", name="Doorway",
            from_room_id=ids[sides[0]], to_room_id=ids[sides[1]], segment_xy_m=segment,
            width_m=round(length, 4), state="unknown",
            provenance=provenance("The opening is a drawn door or passage in a wall.")))
        if len(portals) == MAX_PORTALS:
            break

    zones = []
    for mask in result.outdoor:
        def near(label, r=result.wall_px * 4):
            # The label point usually sits on the lettering itself, which is ink.
            x, y = int(label.x * width), int(label.y * height)
            return mask[max(0, y - r):y + r, max(0, x - r):x + r].any()
        inside = [l for l in labels if l.kind == "outdoor" and near(l)]
        if not inside:
            continue
        loop = _outline(mask, eps)
        polygon = Polygon([metres(p) for p in loop]).buffer(0)
        polygon = _largest(polygon)
        if polygon is None or polygon.area < 1:
            continue
        zones.append(Zone(id=f"outdoor_{len(zones) + 1:02d}", floor_id="floor_0", name=inside[0].name[:100],
            purpose="outdoor", polygon_xy_m=[(round(x, 4), round(y, 4)) for x, y in list(polygon.exterior.coords)[:-1]],
            provenance=provenance("Outdoor area bounded by dashed edges or posts.")))

    layout = Layout(scale_status="unknown", floors=[Floor(id="floor_0", name=floor_name)],
        rooms=rooms, zones=zones[:30], portals=portals, asset_ids=[asset_id] if asset_id else [],
        floor_plan=FloorPlanImage(asset_id=asset_id, origin_xy_m=(0.0, 0.0),
            width_m=round(width * scale, 4), height_m=round(height * scale, 4)) if asset_id else None)
    report = {
        "backend": "wall_trace_v1", "generation_mode": "rooms",
        "working_resolution": [width, height], "resample_factor": round(result.factor, 3),
        "wall_stroke_px": result.wall_px, "metres_per_pixel": round(scale, 5),
        "scale_basis": basis, "dimensioned_rooms": dimensioned,
        "doors_detected": len(result.doors), "spaces_detected": int(result.rooms.max()),
        "spaces_kept": len(rooms), "connections": len(portals), "outdoor_areas": len(zones),
        "labels_found": len(labels), "labels_matched": sum(len(v) for v in names.values()),
        "label_reader": label_reader, "assumed_ceiling_height_m": ceiling_height_m,
        "requires_review": True,
        "limits": [
            "Geometry follows the solid wall bands in the drawing; thin-line plans use the general tracer.",
            "Spaces open to each other without a drawn door are one space.",
            "Scale comes from printed dimensions when they were read, otherwise from assumed door widths.",
        ],
    }
    return layout, report


def trace_layout(image, *, labels=(), asset_id=None, ceiling_height_m=2.6, label_reader="none"):
    """Trace and assemble in one call; raises ``PlanNotReadable`` when unsuitable."""
    from .geometry import validate_layout
    result = trace(image)
    layout, report = build_layout(result, labels=labels, asset_id=asset_id,
                                  ceiling_height_m=ceiling_height_m, label_reader=label_reader)
    issues = validate_layout(layout)
    if issues:
        raise PlanNotReadable("invalid_geometry: " + "; ".join(issues[:3]))
    return layout, report
