"""Assisted extraction of a draft layout from a raster floor plan.

This is an *assisted authoring* adapter, not a measured survey and not a
photogrammetric reconstruction. It reads a printed or exported floor-plan image,
proposes spaces and connections, and records every assertion as ``inferred`` and
unconfirmed so that a person reviews the result before it can be published.

The same numpy/Pillow/Shapely code runs in the API worker and in a plain local
script. Nothing here talks to the database or to the network.
"""

import math
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Polygon
from pydantic import ValidationError
from .models import Floor, FloorPlanImage, Layout, Portal, Provenance, Room

# Interior door leaves are one of the few standardised dimensions on a printed
# plan, so the detected door openings carry the provisional scale. The value is
# an assumption about the drawing, never a measurement of the building.
ASSUMED_DOOR_WIDTH_M = 0.81
WORKING_LONG_SIDE = 1400
MAX_ROOMS = 30
MAX_PORTALS = 60
MAX_VERTICES = 120
MIN_ROOM_AREA_M2 = 0.25


# --------------------------------------------------------------------------- #
# Binary image helpers. Structuring elements are separable rectangles, which is
# enough for wall detection and keeps every operation a handful of array shifts.
# --------------------------------------------------------------------------- #


def _shift(mask, axis, k):
    out = np.zeros_like(mask)
    if axis == 0:
        if k > 0:
            out[k:, :] = mask[:-k, :]
        else:
            out[:k, :] = mask[-k:, :]
    else:
        if k > 0:
            out[:, k:] = mask[:, :-k]
        else:
            out[:, :k] = mask[:, -k:]
    return out


def _spread(mask, axis, r):
    out = mask.copy()
    for k in range(1, r + 1):
        out |= _shift(mask, axis, k)
        out |= _shift(mask, axis, -k)
    return out


def dilate(mask, ry=0, rx=0):
    if ry:
        mask = _spread(mask, 0, ry)
    if rx:
        mask = _spread(mask, 1, rx)
    return mask


def erode(mask, ry=0, rx=0):
    return ~dilate(~mask, ry, rx)


def opened(mask, ry=0, rx=0):
    return dilate(erode(mask, ry, rx), ry, rx)


def closed(mask, ry=0, rx=0):
    return erode(dilate(mask, ry, rx), ry, rx)


def label(mask):
    """Label 4-connected components with run-length union-find. 0 is background."""
    height, width = mask.shape
    parent = [0]

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    rows, previous = [], []
    for y in range(height):
        edges = np.diff(np.concatenate(([0], mask[y].view(np.int8), [0])))
        starts = np.flatnonzero(edges == 1)
        ends = np.flatnonzero(edges == -1)
        current, index = [], 0
        for start, end in zip(starts, ends):
            found = 0
            while index < len(previous) and previous[index][1] <= start:
                index += 1
            probe = index
            while probe < len(previous) and previous[probe][0] < end:
                if found == 0:
                    found = previous[probe][2]
                else:
                    union(found, previous[probe][2])
                probe += 1
            if found == 0:
                found = len(parent)
                parent.append(found)
            current.append((start, end, found))
        rows.append(current)
        previous = current
    remap, out = {}, np.zeros((height, width), np.int32)
    for y, current in enumerate(rows):
        for start, end, found in current:
            root = find(found)
            number = remap.setdefault(root, len(remap) + 1)
            out[y, start:end] = number
    return out, len(remap)


def fill_enclosed(mask):
    """Fill background pockets that do not reach the image border."""
    holes, count = label(~mask)
    outside = set(
        np.unique(np.concatenate([holes[0], holes[-1], holes[:, 0], holes[:, -1]]))
    ) - {0}
    out = mask.copy()
    for index in range(1, count + 1):
        if index not in outside:
            out |= holes == index
    return out


def grow_labels(seeds, allowed, rounds=None):
    """Flood labels outwards, one 4-neighbour ring per iteration."""
    grown = seeds.copy()
    step = 0
    while rounds is None or step < rounds:
        step += 1
        changed = False
        for axis, direction in ((0, 1), (0, -1), (1, 1), (1, -1)):
            source = _shift(grown, axis, direction)
            target = (grown == 0) & allowed & (source > 0)
            if target.any():
                grown[target] = source[target]
                changed = True
        if not changed:
            break
    return grown


# --------------------------------------------------------------------------- #
# Stage 1: ink, walls, building footprint
# --------------------------------------------------------------------------- #


def prepare(image):
    """Return a working-resolution grayscale array and its scale factor."""
    grayscale = image.convert("L")
    longest = max(grayscale.width, grayscale.height)
    factor = WORKING_LONG_SIDE / longest
    factor = min(3.0, max(0.25, factor))
    if abs(factor - 1) > 0.05:
        size = (
            max(1, round(grayscale.width * factor)),
            max(1, round(grayscale.height * factor)),
        )
        grayscale = grayscale.resize(size, Image.LANCZOS)
    else:
        factor = 1.0
    return np.asarray(grayscale).astype(np.int16), factor


def wall_mask(ink, run_length):
    """Keep ink that is part of a long horizontal or vertical stroke.

    Text, hatching, fixture symbols and door arcs are short or curved, so a
    directional opening removes them while leaving the wall skeleton intact.
    """
    horizontal = opened(ink, 0, run_length)
    vertical = opened(ink, run_length, 0)
    # Measure the strokes first: a fixed 3px filter admits fixture outlines in
    # enlarged small scans. Preserve short jambs attached to a substantial wall
    # instead of erasing them with the long-line filter (closets need these).
    radius = max(1, round(stroke_thickness(horizontal | vertical) / 4))
    substantial = dilate(opened(ink, radius, radius), radius, radius)
    components, _ = label(substantial)
    supported = np.unique(components[(horizontal | vertical) & substantial])
    supported = supported[supported > 0]
    return closed(np.isin(components, supported), 1, 1)


def seal_wall_gaps(walls, thickness, doorway_px):
    """Close doorway-sized gaps on wall axes, including corner door jambs.

    These are segmentation barriers, not physical walls. Portal extraction uses
    the original strokes to reopen the gaps. Restrict perpendicular targets to
    their ends so a nearby parallel partition does not close an open room.
    """
    sealed = walls.copy()
    support = max(2, round(thickness))
    reach = max(2, round(doorway_px * 0.7))
    for _ in range(2):
        horizontal = opened(sealed, 0, support)
        vertical = opened(sealed, support, 0)
        vertical_ends = vertical & (
            ~_shift(vertical, 0, support) | ~_shift(vertical, 0, -support)
        )
        horizontal_ends = horizontal & (
            ~_shift(horizontal, 1, support) | ~_shift(horizontal, 1, -support)
        )
        sealed |= closed(horizontal | vertical_ends, 0, reach)
        sealed |= closed(vertical | horizontal_ends, reach, 0)
    return sealed


def footprint_mask(walls, bridge):
    """The enclosed building outline: bridge openings, then fill the inside."""
    envelope = fill_enclosed(closed(walls, bridge, bridge))
    parts, count = label(envelope)
    if count == 0:
        return np.zeros_like(walls)
    areas = np.bincount(parts.ravel())
    areas[0] = 0
    return parts == int(np.argmax(areas))


def stroke_thickness(walls):
    """Median thickness of wall strokes, in working pixels."""
    lengths = []
    for oriented in (walls, walls.T):
        for row in oriented[:: max(1, oriented.shape[0] // 400)]:
            edges = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
            starts = np.flatnonzero(edges == 1)
            ends = np.flatnonzero(edges == -1)
            lengths.extend((ends - starts).tolist())
    thin = [value for value in lengths if 1 <= value <= 30]
    return float(np.median(thin)) if thin else 3.0


# --------------------------------------------------------------------------- #
# Stage 2: door symbols
# --------------------------------------------------------------------------- #


def _circle_score(xs, ys, cx, cy, radius):
    distance = np.hypot(xs - cx, ys - cy)
    band = max(3.0, radius * 0.12)
    return float(((distance > radius - band) & (distance < radius + band)).mean())


def door_symbols(ink, walls, inside, low, high):
    """Find swing-door symbols: a quarter-circle arc plus its leaf.

    A door symbol always spans its own opening, from the hinge jamb round to the
    closed position on the opposite jamb, so the detected ink doubles as a
    barrier between the two spaces it connects.
    """
    thin = ink & ~dilate(walls, 2, 2) & inside
    parts, count = label(thin)
    doors = []
    for index in range(1, count + 1):
        ys, xs = np.nonzero(parts == index)
        if len(ys) < 60:
            continue
        width = int(xs.max() - xs.min()) + 1
        height = int(ys.max() - ys.min()) + 1
        shorter, longer = min(width, height), max(width, height)
        if not low <= shorter <= high or longer > shorter * 1.7:
            continue
        if not 0.03 <= len(ys) / (width * height) <= 0.3:
            continue
        best = None
        step = max(2, longer // 12)
        for cy in range(int(ys.min()) - step, int(ys.max()) + step + 1, step):
            for cx in range(int(xs.min()) - step, int(xs.max()) + step + 1, step):
                radius = float(np.percentile(np.hypot(xs - cx, ys - cy), 80))
                if not low * 0.8 <= radius <= high * 1.2:
                    continue
                score = _circle_score(xs, ys, cx, cy, radius)
                if best is None or score > best[0]:
                    best = (score, cx, cy, radius)
        if best is None or best[0] < 0.45:
            continue
        score, cx, cy, radius = best
        # The arc is centred on the hinge jamb and ends where the closed door
        # would meet the opposite jamb, so the opening is the radius itself.
        reach = max(4, round(radius * 0.18))
        beside_wall = dilate(walls, reach, reach)
        if not beside_wall[int(round(cy)), int(round(cx))]:
            continue
        distance = np.hypot(xs - cx, ys - cy)
        band = max(3.0, radius * 0.12)
        on_arc = (distance > radius - band) & (distance < radius + band)
        landing = on_arc & beside_wall[ys, xs]
        if landing.sum() < 3:
            continue
        far = (float(xs[landing].mean()), float(ys[landing].mean()))
        reachx, reachy = far[0] - cx, far[1] - cy
        length = math.hypot(reachx, reachy) or 1.0
        reachx, reachy = reachx / length, reachy / length
        far = (cx + reachx * radius, cy + reachy * radius)
        doors.append(
            {
                "component": index,
                "hinge": (float(cx), float(cy)),
                "radius": float(radius),
                "score": round(score, 3),
                "opening": ((float(cx), float(cy)), far),
                "span_px": float(radius),
                "pixels": (parts == index),
            }
        )
    return doors


def door_barriers(doors, shape, width, reach=0):
    """Close each detected doorway with its own chord, so the spaces separate.

    The chord is extended a little past both jambs so that it meets the wall
    strokes it sits between and free space cannot leak around its ends.
    """
    canvas = Image.new("1", (shape[1], shape[0]), 0)
    pen = ImageDraw.Draw(canvas)
    for door in doors:
        (x1, y1), (x2, y2) = door["opening"]
        length = math.hypot(x2 - x1, y2 - y1) or 1.0
        ux, uy = (x2 - x1) / length, (y2 - y1) / length
        pen.line(
            [
                (x1 - ux * reach, y1 - uy * reach),
                (x2 + ux * reach, y2 + uy * reach),
            ],
            fill=1,
            width=width,
        )
    return np.asarray(canvas, dtype=bool)


def _widest_pair(points):
    best, pair = -1.0, (points[0], points[-1])
    for i, a in enumerate(points):
        for b in points[i + 1 :]:
            distance = math.dist(a, b)
            if distance > best:
                best, pair = distance, (a, b)
    return pair


# --------------------------------------------------------------------------- #
# Stage 2b: printed room labels
# --------------------------------------------------------------------------- #

# Names a reviewer would recognise on a residential plan. A label is only
# accepted when it is close to one of these, so a misread never invents a room.
ROOM_WORDS = (
    "GREAT ROOM", "LIVING ROOM", "FAMILY ROOM", "DINING", "DINING ROOM",
    "KITCHEN", "NOOK", "BREAKFAST", "PANTRY", "FOYER", "ENTRY", "HALL",
    "LAUNDRY", "UTILITY", "MUD ROOM", "GARAGE", "2 CAR GARAGE", "3 CAR GARAGE",
    "PRIMARY SUITE", "PRIMARY BEDROOM", "MASTER SUITE", "MASTER BEDROOM",
    "OWNER'S SUITE", "BEDROOM", "BEDROOM 2", "BEDROOM 3", "BEDROOM 4",
    "PRIMARY BATH", "MASTER BATH", "BATH", "BATH 2", "BATH 3", "POWDER",
    "W.I.C.", "WALK-IN CLOSET", "CLOSET", "LINEN", "COATS", "STORAGE",
    "COVERED PATIO", "PATIO", "COVERED PORCH", "PORCH", "DECK", "BALCONY",
    "OFFICE", "DEN", "STUDY", "LOFT", "BONUS ROOM", "FLEX", "MECHANICAL",
    "STAIRS", "LANAI", "WORKSHOP", "SUITE",
)


def text_blocks(ink, walls, inside):
    """Group small ink marks into printed label lines."""
    marks = ink & ~dilate(walls, 2, 2) & inside
    parts, count = label(marks)
    glyphs = []
    for index in range(1, count + 1):
        ys, xs = np.nonzero(parts == index)
        if len(ys) < 10:
            continue
        height = int(ys.max() - ys.min()) + 1
        width = int(xs.max() - xs.min()) + 1
        if not 6 <= height <= 40 or width > 2.5 * height:
            continue
        glyphs.append([int(xs.min()), int(ys.min()), width, height])
    glyphs.sort(key=lambda box: (box[1], box[0]))
    lines = []
    for box in glyphs:
        middle = box[1] + box[3] / 2
        for line in lines:
            last = line[-1]
            if (
                abs(middle - (last[1] + last[3] / 2)) < 0.45 * box[3]
                and 0 <= box[0] - (last[0] + last[2]) < 1.5 * box[3]
            ):
                line.append(box)
                break
        else:
            lines.append([box])
    blocks = []
    for line in lines:
        if len(line) < 2:
            continue
        left = min(box[0] for box in line)
        top = min(box[1] for box in line)
        right = max(box[0] + box[2] for box in line)
        bottom = max(box[1] + box[3] for box in line)
        blocks.append((left, top, right, bottom))
    return blocks


def read_text(image, blocks, factor):
    """Read label blocks with Tesseract when it is installed; skip it otherwise."""
    try:
        import pytesseract
    except ImportError:
        return None, "pytesseract is not installed"
    readings = []
    try:
        for left, top, right, bottom in blocks:
            pad = 4
            box = (
                max(0, (left - pad)) / factor,
                max(0, (top - pad)) / factor,
                (right + pad) / factor,
                (bottom + pad) / factor,
            )
            crop = image.convert("L").crop(tuple(round(value) for value in box))
            crop = crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS)
            text = pytesseract.image_to_string(crop, config="--psm 7").strip()
            readings.append(((left, top, right, bottom), text))
    except Exception as error:  # pragma: no cover - depends on a local binary
        return None, f"Tesseract could not be used ({type(error).__name__})"
    return readings, None


def name_spaces(image, blocks, spaces, factor):
    """Give each space the labels printed inside it, when a reader is available."""
    readings, note = read_text(image, blocks, factor)
    names, matched = {}, 0
    for (left, top, right, bottom), text in stack_readings(readings or []):
        name, score = match_room_word(text)
        if not name:
            continue
        number = int(spaces[int((top + bottom) / 2), int((left + right) / 2)])
        if not number:
            continue
        matched += 1
        names.setdefault(number, []).append(
            (round(score, 2), bottom - top, right - left, name)
        )
    return names, matched, note or "Tesseract"


def combined_name(candidates):
    """Name a space after the labels printed inside it, biggest lettering first."""
    if not candidates:
        return None
    chosen = []
    for _, _, _, name in sorted(candidates, key=lambda item: (-item[1], -item[0])):
        if name not in chosen and not any(name in other for other in chosen):
            chosen = [other for other in chosen if other not in name] + [name]
        if len(chosen) == 3:
            break
    return " / ".join(chosen)[:100]


def stack_readings(readings):
    """Offer stacked label lines as one name, so "GREAT / ROOM" can be matched."""
    combined = list(readings)
    for index, (first, first_text) in enumerate(readings):
        for second, second_text in readings[index + 1 :]:
            overlap = min(first[2], second[2]) - max(first[0], second[0])
            gap = second[1] - first[3]
            line = first[3] - first[1]
            if overlap > 0.4 * min(first[2] - first[0], second[2] - second[0]) and (
                -2 <= gap <= 1.1 * line
            ):
                combined.append(
                    (
                        (
                            min(first[0], second[0]),
                            first[1],
                            max(first[2], second[2]),
                            second[3],
                        ),
                        f"{first_text} {second_text}",
                    )
                )
    return combined


def match_room_word(text):
    """Snap a noisy reading onto a known room name, or reject it."""
    cleaned = "".join(
        character
        for character in text.upper()
        if character.isalnum() or character in " .'-"
    ).strip()
    if len(cleaned) < 3:
        return None, 0.0
    best, score = None, 0.0
    for word in ROOM_WORDS:
        similarity = _similarity(cleaned, word)
        if similarity > score:
            best, score = word, similarity
    if score < 0.68:
        return None, score
    return best.title().replace("W.I.C.", "W.I.C."), score


def _similarity(first, second):
    if not first or not second:
        return 0.0
    previous = list(range(len(second) + 1))
    for i, a in enumerate(first, 1):
        current = [i]
        for j, b in enumerate(second, 1):
            current.append(
                min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a != b))
            )
        previous = current
    return 1 - previous[-1] / max(len(first), len(second))


# --------------------------------------------------------------------------- #
# Stage 3: spaces
# --------------------------------------------------------------------------- #


def partition(free, inside, thickness, seed_radius, min_pixels):
    """Split the enclosed free space into spaces and grow them to wall centres.

    Recognised doorways are already closed in ``free``. Openings that no door
    symbol explained are separated here instead: a space keeps its own identity
    only where it is wider than a doorway, so a room is not merged with its
    neighbour through a gap that a person would call a door.
    """
    cores, count = label(opened(free, seed_radius, seed_radius))
    # A narrow bathroom/closet can disappear completely under the opening.
    # Keep its enclosed component as a seed instead of letting another room
    # consume it or dropping it from the model.
    enclosed, enclosed_count = label(free)
    enclosed_areas = np.bincount(enclosed.ravel())
    seeded = set(np.unique(enclosed[cores > 0]))
    for index in range(1, enclosed_count + 1):
        if enclosed_areas[index] >= min_pixels and index not in seeded:
            count += 1
            cores[enclosed == index] = count
    areas = np.bincount(cores.ravel())
    keep = [i for i in range(1, count + 1) if areas[i] >= min_pixels]
    keep.sort(key=lambda i: -areas[i])
    keep = keep[:MAX_ROOMS]
    remap = np.zeros(count + 1, np.int32)
    for number, index in enumerate(keep, 1):
        remap[index] = number
    spaces = grow_labels(remap[cores], free)
    # Half of each wall belongs to each side, so neighbouring spaces meet on the
    # wall centre line and share an exact boundary.
    spaces = grow_labels(spaces, inside, rounds=max(1, round(thickness / 2) + 1))
    return spaces, len(keep)


def rejoin_narrow_splits(spaces, walls, doorway_px, thickness):
    """Undo gap seals crossing a narrow enclosure with no dividing wall.

    A break in a thin closet side can look like a corner jamb. Only rejoin two
    narrow pieces when their entire shared seam lacks wall evidence; a real
    partition or either wider room prevents this operation.
    """
    bounds = {}
    for number in np.unique(spaces):
        if number == 0:
            continue
        ys, xs = np.nonzero(spaces == number)
        bounds[int(number)] = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    for (first, second), points in contacts(spaces, np.ones_like(walls)).items():
        a, b = bounds[first], bounds[second]
        widths = [min(p[2] - p[0], p[3] - p[1]) for p in (a, b)]
        if max(widths) > doorway_px * 1.1:
            continue
        union_width = max(a[2], b[2]) - min(a[0], b[0])
        union_height = max(a[3], b[3]) - min(a[1], b[1])
        if max(union_width, union_height) < 2 * min(union_width, union_height):
            continue
        xs, ys = np.array(points).T
        # Ignore jamb intersections at the two ends of the seam.
        axis = xs if np.ptp(xs) > np.ptp(ys) else ys
        middle = (axis > axis.min() + thickness) & (axis < axis.max() - thickness)
        if not middle.any() or walls[ys[middle], xs[middle]].any():
            continue
        spaces[spaces == second] = first
    numbers = np.unique(spaces)
    numbers = numbers[numbers > 0]
    remap = np.zeros(int(spaces.max()) + 1, np.int32)
    remap[numbers] = np.arange(1, len(numbers) + 1)
    return remap[spaces], len(numbers)


def trace_outline(mask):
    """Trace the outer boundary of a mask as a rectilinear pixel-corner loop."""
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return []
    top, bottom = int(ys.min()), int(ys.max()) + 1
    left, right = int(xs.min()), int(xs.max()) + 1
    window = mask[top:bottom, left:right]
    padded = np.zeros((window.shape[0] + 2, window.shape[1] + 2), bool)
    padded[1:-1, 1:-1] = window
    edges = defaultdict(list)
    ys, xs = np.nonzero(padded)
    for y, x in zip(ys.tolist(), xs.tolist()):
        if not padded[y - 1, x]:
            edges[(x, y)].append((x + 1, y))
        if not padded[y, x + 1]:
            edges[(x + 1, y)].append((x + 1, y + 1))
        if not padded[y + 1, x]:
            edges[(x + 1, y + 1)].append((x, y + 1))
        if not padded[y, x - 1]:
            edges[(x, y + 1)].append((x, y))
    loops = []
    while edges:
        start = next(iter(edges))
        loop, point = [], start
        while True:
            options = edges.get(point)
            if not options:
                break
            nxt = options.pop()
            if not options:
                del edges[point]
            loop.append(point)
            point = nxt
            if point == start:
                break
        if len(loop) >= 4:
            loops.append(loop)
    if not loops:
        return []
    outer = max(loops, key=_absolute_area)
    return [(x + left - 1, y + top - 1) for x, y in outer]


def _absolute_area(loop):
    total = 0.0
    for (x1, y1), (x2, y2) in zip(loop, loop[1:] + loop[:1]):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def cluster_axis(values, tolerance):
    """Snap coordinates that sit within a tolerance of each other onto one line."""
    table, group = {}, []
    for value in sorted(set(values)):
        if group and value - group[0] > tolerance:
            centre = sum(group) / len(group)
            table.update({member: centre for member in group})
            group = []
        group.append(value)
    if group:
        centre = sum(group) / len(group)
        table.update({member: centre for member in group})
    return table


def tidy_polygon(points):
    """Drop repeated, collinear and spike vertices, keeping the winding order."""
    result = list(points)
    for _ in range(8):
        cleaned = []
        for point in result:
            if not cleaned or math.dist(point, cleaned[-1]) > 1e-9:
                cleaned.append(point)
        while len(cleaned) > 1 and math.dist(cleaned[0], cleaned[-1]) <= 1e-9:
            cleaned.pop()
        kept, count = [], len(cleaned)
        for index in range(count):
            previous = cleaned[index - 1]
            current = cleaned[index]
            following = cleaned[(index + 1) % count]
            cross = (current[0] - previous[0]) * (following[1] - previous[1]) - (
                current[1] - previous[1]
            ) * (following[0] - previous[0])
            if abs(cross) > 1e-9:
                kept.append(current)
        if kept == result:
            return kept
        result = kept
        if len(result) < 3:
            break
    return result


def polygon_area(points):
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
        total += x1 * y2 - x2 * y1
    return total / 2


# --------------------------------------------------------------------------- #
# Stage 4: layout assembly
# --------------------------------------------------------------------------- #


def _provenance(asset_id, detail):
    return Provenance(
        kind="inferred",
        source_ids=[asset_id] if asset_id else [],
        confirmed=False,
        explanation=(
            "Automatically traced from a raster floor plan. " + detail + " Geometry, "
            "openings and metric scale are unverified estimates from a drawing; "
            "review and correct them against the real building before publishing."
        )[:1000],
    )


def generate_layout(image, *, asset_id=None, ceiling_height_m=2.6,
                    floor_name="Ground floor (traced from plan)"):
    """Always return a valid draft for a decoded image, with honest fallback labels.

    Extraction failures are recoverable authoring outcomes. Private asset and
    image-decoding failures remain the responsibility of the caller.
    """
    from .geometry import validate_layout

    failures = []
    for thin in (False, True):
        try:
            layout, report = extract_layout(
                image, asset_id=asset_id, ceiling_height_m=ceiling_height_m,
                floor_name=floor_name, thin_lines=thin,
            )
            issues = validate_layout(layout)
            if thin:
                small = sum(Polygon(room.polygon_xy_m).area < 4 * ASSUMED_DOOR_WIDTH_M**2
                            for room in layout.rooms)
                if len(layout.rooms) == MAX_ROOMS or (small > 8 and small > len(layout.rooms) / 2):
                    issues.append("ambiguous_plan: thin fixture lines produced too many small regions; interior rooms are unreliable")
            if not issues:
                report["generation_mode"] = "rooms"
                return layout, report
            failures.append("invalid_geometry: " + "; ".join(issues[:3]))
        except (PlanNotReadable, ValidationError) as exc:
            failures.append(str(exc)[:500])
    return approximate_layout(image, asset_id=asset_id,
                              ceiling_height_m=ceiling_height_m,
                              reason=" | ".join(failures)[:1000])


def approximate_layout(image, *, asset_id=None, ceiling_height_m=2.6, reason=""):
    """A footprint extrusion, or an explicitly generic image reference volume."""
    gray, factor = prepare(image)
    height, width = gray.shape
    ink = gray < 210
    outline = None
    if 0.002 < ink.mean() < 0.45:
        run = max(6, round(max(gray.shape) * 0.011))
        lines = opened(ink, 0, run) | opened(ink, run, 0)
        mask = footprint_mask(lines, max(12, round(max(gray.shape) * 0.045)))
        if mask.sum() >= width * height * 0.01:
            loop = trace_outline(mask)
            if len(loop) >= 4:
                candidate = Polygon(loop).simplify(3, preserve_topology=True)
                if candidate.is_valid and not candidate.is_empty:
                    outline = list(candidate.exterior.coords)[:-1]
    mode = "footprint" if outline else "reference_volume"
    if not outline:
        outline = [(width * .1, height * .1), (width * .9, height * .1),
                   (width * .9, height * .9), (width * .1, height * .9)]
    # No dimension or door was recovered reliably. Make the longest extent 10m
    # solely to provide a usable editor scale, and persist that assumption.
    xs, ys = zip(*outline)
    scale = 10 / max(max(xs) - min(xs), max(ys) - min(ys), 1)
    polygon = [(round(x * scale, 4), round((height - y) * scale, 4)) for x, y in outline]
    if len(polygon) > MAX_VERTICES:
        polygon = [(min(xs)*scale, (height-max(ys))*scale),
                   (max(xs)*scale, (height-max(ys))*scale),
                   (max(xs)*scale, (height-min(ys))*scale),
                   (min(xs)*scale, (height-min(ys))*scale)]
        mode = "reference_volume"
    if polygon_area(polygon) < 0:
        polygon.reverse()
    detail = ("Approximate footprint only; interior rooms were not recovered."
              if mode == "footprint" else
              "Generic reference volume only; no building geometry was recovered.")
    explanation = (f"{detail} Longest extent is assumed to be 10 m and ceiling height "
                   f"{ceiling_height_m:g} m. Use the source image to edit the layout. "
                   "This is not a reconstructed room or measured building.")
    layout = Layout(
        scale_status="unknown", floors=[Floor(id="floor_0", name="Approximate floor")],
        rooms=[Room(id="approximate_footprint", floor_id="floor_0",
                    name="Approximate footprint" if mode == "footprint" else "Untraced reference volume",
                    polygon_xy_m=polygon, height_m=ceiling_height_m,
                    provenance=Provenance(kind="inferred", confirmed=False,
                                          source_ids=[asset_id] if asset_id else [],
                                          explanation=explanation))],
        asset_ids=[asset_id] if asset_id else [],
        floor_plan=FloorPlanImage(asset_id=asset_id, origin_xy_m=(0, 0),
                                  width_m=width*scale, height_m=height*scale) if asset_id else None,
    )
    return layout, {
        "backend": "floorplan_raster_v1", "extractor_version": 2,
        "generation_mode": mode, "fallback_reason": reason,
        "warning": explanation, "spaces_kept": 1, "spaces_detected": 0,
        "connections": 0, "label_reader": "not used for approximate model",
        "scale_basis": "assumed 10 m longest extent", "metres_per_pixel": scale,
        "working_resolution": [width, height], "resample_factor": factor,
        "assumed_ceiling_height_m": ceiling_height_m, "requires_review": True,
        "limits": [explanation],
    }


def extract_layout(
    image,
    *,
    asset_id=None,
    floor_name="Ground floor (traced from plan)",
    ceiling_height_m=2.6,
    door_width_m=ASSUMED_DOOR_WIDTH_M,
    thin_lines=False,
):
    """Extract an unconfirmed :class:`Layout` from a floor-plan image.

    Returns ``(layout, report)``. The report records the measurements the
    extraction relied on, so a reviewer can see why the result looks as it does.
    """
    grayscale, factor = prepare(image)
    height, width = grayscale.shape
    ink = grayscale < (210 if thin_lines else 165)
    coverage = float(ink.mean())
    if coverage < 0.002 or coverage > 0.45:
        raise PlanNotReadable(
            "unsupported_drawing: the image does not look like a line floor plan "
            f"({coverage:.1%} of pixels are dark)"
        )
    # A plan is drawn in ink on paper: nearly every pixel is either line or
    # background, and only the edges of strokes land in between. A photograph is
    # mostly shading. Refusing it here keeps a room interior from being read as
    # a set of walls and turned into a layout that was never in the picture.
    midtone = float(((grayscale >= 60) & (grayscale <= 200)).mean())
    if midtone > 0.35:
        raise PlanNotReadable(
            "unsupported_drawing: the image looks like a photograph rather than "
            f"a line floor plan ({midtone:.0%} of it is continuous shading). "
            "Trace a floor-plan drawing instead; photographs are not reconstructed."
        )
    long_side = max(height, width)
    run_length = max(6, round(long_side * 0.011))
    if thin_lines:
        walls = closed(opened(ink, 0, run_length) | opened(ink, run_length, 0), 1, 1)
        components, component_count = label(walls)
        supported = []
        for number in range(1, component_count + 1):
            ys, xs = np.nonzero(components == number)
            if max(np.ptp(xs), np.ptp(ys)) >= long_side * 0.15:
                supported.append(number)
        walls = np.isin(components, supported)
    else:
        walls = wall_mask(ink, run_length)
    if walls.sum() < long_side:
        raise PlanNotReadable(
            "no_walls_found: no continuous straight wall lines were detected"
        )
    # Door recognition needs thin straight leaf strokes removed as well as the
    # structural walls. Keep this symbol mask separate from the thicker mask
    # used to partition rooms.
    substantial = dilate(opened(ink, 1, 1), 1, 1)
    run_length = max(6, round(long_side * 0.011))
    symbol_walls = closed(
        (opened(ink, 0, run_length) | opened(ink, run_length, 0)) & substantial,
        1, 1,
    )
    if thin_lines:
        symbol_walls = walls
    thickness = stroke_thickness(symbol_walls)
    # Use the unexpanded line mask for the envelope: attached jamb recovery can
    # touch a tightly cropped page edge and otherwise open its enclosed region
    # to the exterior during the morphological close.
    inside = footprint_mask(symbol_walls, max(12, round(long_side * 0.045)))
    if inside.sum() < 0.01 * height * width:
        raise PlanNotReadable(
            "no_enclosed_outline: the drawing has no closed building outline"
        )
    doors = door_symbols(
        ink,
        symbol_walls,
        inside,
        low=max(8, round(long_side * 0.022)),
        high=max(20, round(long_side * 0.075)),
    )
    spans = sorted(door["span_px"] for door in doors)
    if spans:
        typical = spans[len(spans) // 2]
        scale = door_width_m / typical
        basis = f"{len(spans)} detected door openings (median {typical:.0f} px)"
    elif thin_lines:
        scale = door_width_m / (long_side * 0.04)
        basis = "assumed doorway span of 4% of the image long side; no door symbols found"
    else:
        # Interior partitions are close to 0.11 m through the wall, which is a
        # weaker but still usable fallback when no door symbol is recognised.
        scale = 0.11 / max(thickness, 1.0)
        basis = f"wall stroke thickness ({thickness:.1f} px), no door symbols found"

    doorway_px = typical if spans else 0.9 / scale
    barrier = seal_wall_gaps(walls, thickness, doorway_px)
    sealed_gaps = dilate(barrier & ~walls, round(thickness), round(thickness))
    for door in doors:
        chord = door_barriers(
            [door], walls.shape, max(2, round(thickness / 2)), reach=thickness
        )
        # Prefer the actual wall axis to the approximate arc fit. Adding both
        # creates zigzags inside a straight doorway and can lose its portal.
        midpoint = np.mean(door["opening"], axis=0).round().astype(int)
        mx, my = midpoint
        already_sealed = (0 <= my < height and 0 <= mx < width
                          and sealed_gaps[my, mx])
        if not already_sealed:
            barrier |= chord
    free = inside & ~barrier
    seed_radius = max(3, round(doorway_px * 0.72))
    spaces, count = partition(
        free, inside, stroke_thickness(walls), seed_radius, 0.25 / (scale * scale)
    )
    spaces, count = rejoin_narrow_splits(spaces, walls, doorway_px, thickness)
    if count == 0:
        raise PlanNotReadable(
            "no_spaces_found: no enclosed space large enough to be a room"
        )

    blocks = text_blocks(ink, walls, inside)
    names, label_hits, reader = name_spaces(image, blocks, spaces, factor)

    origin_y = float(height)
    outlines = {}
    for number in range(1, count + 1):
        loop = trace_outline(fill_enclosed(spaces == number))
        if len(loop) >= 4:
            outlines[number] = [
                (x * scale, (origin_y - y) * scale) for x, y in loop
            ]
    tolerance = max(1.5 * scale, thickness * scale * 0.6)
    snap_x = cluster_axis(
        [point[0] for loop in outlines.values() for point in loop], tolerance
    )
    snap_y = cluster_axis(
        [point[1] for loop in outlines.values() for point in loop], tolerance
    )

    rooms, polygons = [], {}
    for number, loop in sorted(outlines.items()):
        snapped = tidy_polygon([(snap_x[x], snap_y[y]) for x, y in loop])
        if len(snapped) < 3 or len(snapped) > MAX_VERTICES:
            continue
        if abs(polygon_area(snapped)) < MIN_ROOM_AREA_M2:
            continue
        if polygon_area(snapped) < 0:
            snapped.reverse()
        identifier = f"space_{number:02d}"
        polygons[number] = snapped
        rooms.append(
            Room(
                id=identifier,
                floor_id="floor_0",
                name=combined_name(names.get(number)) or f"Space {number:02d}",
                polygon_xy_m=[(round(x, 4), round(y, 4)) for x, y in snapped],
                height_m=ceiling_height_m,
                provenance=_provenance(
                    asset_id,
                    "The boundary follows the wall centre lines read from the "
                    f"drawing. Ceiling height is assumed to be {ceiling_height_m:g} m. "
                    + (
                        "The name comes from the printed labels inside this "
                        "space; spaces that a drawing labels separately are "
                        "still one space here when no wall divides them."
                        if names.get(number)
                        else "No printed label was matched, so the name is a "
                        "placeholder."
                    ),
                ),
            )
        )

    if not rooms:
        raise PlanNotReadable("no_spaces_found: no usable space remained after geometry filtering")

    portals = build_portals(
        spaces, polygons, doors, barrier, inside, scale, asset_id, origin_y, walls
    )

    layout = Layout(
        scale_status="unknown",
        floors=[Floor(id="floor_0", name=floor_name)],
        rooms=rooms,
        portals=portals[:MAX_PORTALS],
        asset_ids=[asset_id] if asset_id else [],
        floor_plan=(
            FloorPlanImage(
                asset_id=asset_id,
                origin_xy_m=(0.0, 0.0),
                width_m=round(width * scale, 4),
                height_m=round(height * scale, 4),
            )
            if asset_id
            else None
        ),
    )
    report = {
        "backend": "floorplan_raster_v1",
        "extractor_version": 2,
        "line_mode": "thin" if thin_lines else "standard",
        "working_resolution": [int(width), int(height)],
        "resample_factor": round(factor, 3),
        "metres_per_pixel": round(scale, 5),
        "scale_basis": basis,
        "assumed_door_width_m": door_width_m,
        "assumed_ceiling_height_m": ceiling_height_m,
        "wall_stroke_px": round(thickness, 1),
        "footprint_m2": round(float(inside.sum()) * scale * scale, 1),
        "doors_detected": len(doors),
        "spaces_detected": count,
        "spaces_kept": len(rooms),
        "labels_found": len(blocks),
        "labels_matched": label_hits,
        "label_reader": reader,
        "connections": len(layout.portals),
        "requires_review": True,
        "limits": [
            "Scale is provisional: it comes from assumed door widths or wall thickness, not a measured dimension.",
            "Spaces open to each other without a door are merged into one space.",
            "Names only repeat printed labels; ceiling heights, door states and widths are never read from the drawing.",
            "Furniture, fixtures, stairs, multiple floors and exterior structures are ignored.",
        ],
    }
    return layout, report


def build_portals(
    spaces, polygons, doors, barrier, inside, scale, asset_id, origin_y, walls=None
):
    """Connections from door symbols, plus openings where two spaces meet."""
    portals, used = [], []

    def to_world(point):
        return (point[0] * scale, (origin_y - point[1]) * scale)

    def add(first, second, pair, name, detail, width_hint=None):
        rooms = sorted(pair)
        edge = shared_edge(polygons.get(rooms[0]), polygons.get(rooms[1]), first, second)
        if edge is None:
            return False
        start, end = edge
        width = math.dist(start, end)
        if not 0.4 <= width <= 3.0:
            return False
        centre = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        for other_rooms, other_centre, other_width in used:
            if math.dist(centre, other_centre) < 0.35:
                return False
            # One doorway must not be reported twice because two marks near it
            # were both read as doors: on the same wall, overlapping spans are
            # the same opening.
            if other_rooms == rooms and math.dist(centre, other_centre) < (
                width + other_width
            ) / 2:
                return False
        used.append((rooms, centre, width))
        portals.append(
            Portal(
                id=f"portal_{len(portals) + 1:02d}",
                name=name,
                from_room_id=f"space_{rooms[0]:02d}",
                to_room_id=f"space_{rooms[1]:02d}",
                segment_xy_m=(
                    (round(start[0], 4), round(start[1], 4)),
                    (round(end[0], 4), round(end[1], 4)),
                ),
                width_m=round(width, 4),
                state="unknown",
                provenance=_provenance(asset_id, detail),
            )
        )
        return True

    door_detail = (
        "A swing-door symbol was recognised here; the leaf width is the drawn "
        "arc radius and the door state is unknown."
    )
    opening_detail = (
        "The two spaces meet through a gap in the wall with no door symbol "
        "drawn; it is modelled as an opening of unknown state."
    )
    for door in doors:
        first, second = (to_world(point) for point in door["opening"])
        pair = sides_of(spaces, door["opening"], scale)
        if pair:
            add(first, second, pair, "Door", door_detail)

    def door_at(start, end):
        """The door symbol covering a gap, if one was drawn over it."""
        centre = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        for door in doors:
            hinge = to_world(door["hinge"])
            if math.dist(hinge, centre) <= max(0.6, door["radius"] * scale * 1.3):
                return door
        return None

    free = inside & ~barrier
    for pair, points in contacts(spaces, free).items():
        for run in group_runs(points):
            first, second = (to_world(point) for point in run)
            # A doorway the symbol pass could not place -- because the leaf was
            # drawn across the opening, or the wall runs at an angle -- still
            # shows up here as a gap. Report it as the door it was drawn as,
            # rather than as a plain hole in the wall.
            door = door_at(first, second)
            if door is None:
                add(first, second, pair, "Opening", opening_detail)
            else:
                add(first, second, pair, "Door", door_detail)

    if walls is None:
        return portals
    # The chord drawn through a door symbol is used to hold the two spaces apart
    # while they are grown, but it is not a wall. Where that chord is all that
    # separates them, the doorway would otherwise be sealed and the rooms left
    # unconnected, so the gap in the walls themselves is read here instead.
    unsealed = inside & ~walls
    for pair, points in contacts(spaces, unsealed).items():
        if any(sorted(pair) == list(rooms) for rooms, _, _ in used):
            continue
        for run in group_runs(points):
            first, second = (to_world(point) for point in run)
            door = door_at(first, second)
            add(first, second, pair, "Door" if door else "Opening",
                door_detail if door else opening_detail)
    return portals


def sides_of(spaces, opening, scale):
    """Which two spaces a door opening separates.

    The probe steps out from several points along the opening, not just its
    midpoint, so a doorway that sits beside a cupboard or a corner still finds
    the rooms on either side. Distances follow the opening's own width, which
    keeps the probe valid at any drawing resolution.
    """
    (x1, y1), (x2, y2) = opening
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 1:
        return None
    nx, ny = -(y2 - y1) / length, (x2 - x1) / length
    distances = [step for step in (3, 6, 10, 15) if step < length]
    distances += [length * fraction for fraction in (0.35, 0.6, 0.9, 1.3)]
    votes = ({}, {})
    for along in (0.5, 0.3, 0.7):
        cx = x1 + (x2 - x1) * along
        cy = y1 + (y2 - y1) * along
        for side, sign in enumerate((1, -1)):
            for distance in distances:
                x = int(round(cx + nx * distance * sign))
                y = int(round(cy + ny * distance * sign))
                if not (0 <= y < spaces.shape[0] and 0 <= x < spaces.shape[1]):
                    continue
                if spaces[y, x]:
                    found = int(spaces[y, x])
                    votes[side][found] = votes[side].get(found, 0) + 1
                    break
    if not votes[0] or not votes[1]:
        return None
    first = max(votes[0], key=lambda space: votes[0][space])
    second = max(votes[1], key=lambda space: votes[1][space])
    if first == second:
        return None
    return (first, second)


def contacts(spaces, free):
    """Free-space pixels where two different spaces touch: wall gaps."""
    pairs = defaultdict(list)
    for axis in (0, 1):
        other = _shift(spaces, axis, 1)
        touching = (spaces > 0) & (other > 0) & (spaces != other) & free
        ys, xs = np.nonzero(touching)
        for y, x in zip(ys.tolist(), xs.tolist()):
            a, b = int(spaces[y, x]), int(other[y, x])
            pairs[(min(a, b), max(a, b))].append((x, y))
    return pairs


def group_runs(points, gap=6):
    """Split contact pixels into separate, straight openings."""
    groups = []
    for point in sorted(points):
        for group in groups:
            if any(
                abs(point[0] - other[0]) <= gap and abs(point[1] - other[1]) <= gap
                for other in group[-12:]
            ):
                group.append(point)
                break
        else:
            groups.append([point])
    runs = []
    for group in groups:
        runs.extend(_straight_runs(group))
    return runs


def _straight_runs(group, depth=0):
    """An opening is a straight gap; a bent contact is two different openings."""
    if len(group) < 4:
        return []
    first, last = _widest_pair(group)
    if depth >= 3 or math.dist(first, last) < 4:
        return [(first, last)]
    worst = max(group, key=lambda point: _point_to_segment(point, first, last))
    if _point_to_segment(worst, first, last) <= 2.5:
        return [(first, last)]
    near, far = [], []
    for point in group:
        if math.dist(point, first) <= math.dist(point, last):
            near.append(point)
        else:
            far.append(point)
    return _straight_runs(near, depth + 1) + _straight_runs(far, depth + 1)


def shared_edge(first_polygon, second_polygon, start, end):
    """Place an opening on the boundary the two spaces actually share.

    Both spaces were grown until they met, so the opening already lies on their
    common boundary; this pulls it exactly onto both outlines and refuses the
    connection when they do not really touch there.
    """
    if not first_polygon or not second_polygon:
        return None
    moved = []
    for point in (start, end):
        on_first = _nearest_point(first_polygon, point)
        on_second = _nearest_point(second_polygon, point)
        if math.dist(on_first, on_second) > 0.14:
            return None
        moved.append(
            ((on_first[0] + on_second[0]) / 2, (on_first[1] + on_second[1]) / 2)
        )
    # Trim the ends back if the opening overshoots a corner, rather than
    # claiming an opening that does not sit on the shared wall.
    for trim in (0.0, 0.06, 0.12, 0.2):
        span = (
            _interpolate(moved[0], moved[1], trim),
            _interpolate(moved[0], moved[1], 1 - trim),
        )
        if math.dist(*span) < 0.4:
            return None
        line = LineString(span)
        if all(Polygon(polygon).boundary.buffer(0.05).covers(line)
               for polygon in (first_polygon, second_polygon)):
            return span
    return None


def _nearest_point(polygon, point):
    best = None
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = dx * dx + dy * dy
        t = 0.0 if length <= 1e-12 else max(
            0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)
        )
        candidate = (a[0] + t * dx, a[1] + t * dy)
        distance = math.dist(point, candidate)
        if best is None or distance < best[0]:
            best = (distance, candidate)
    return best[1]


def _boundary_distance(polygon, point):
    return min(
        _point_to_segment(point, a, b)
        for a, b in zip(polygon, polygon[1:] + polygon[:1])
    )


def _interpolate(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _point_to_segment(point, a, b):
    px, py = point
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    if length <= 1e-12:
        return math.dist(point, a)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
    return math.dist(point, (ax + t * dx, ay + t * dy))


class PlanNotReadable(ValueError):
    """The image could not be read as a floor plan; no geometry was invented."""
