"""People heatmap: where positioned people were seen on a site's floor plan.

Two kinds of sighting feed the map:

* Positioned sightings (``floor_point``) add a Gaussian footprint whose width
  follows their stated position uncertainty, so vague positions spread out and
  precise ones stay sharp.
* Camera events with no position (live Ring motion, which only says which
  camera fired) are an estimate: each one is spread softly across that camera's
  field-of-view wedge, at a lower weight than a positioned sighting. Events from
  cameras that are not on the map stay counted in ``unpositioned``.

The response counts the two separately (``samples`` and ``estimated``) so the
client can say how much of the map is an estimate. The grid is returned normalised to 0..1 together with its geometry, so a
client can draw it in 2D or 3D at any zoom.

Time windows are presets today (1 h, 12 h, 24 h) but the builder takes an
explicit ``since``/``until`` range, so finer controls can be added without
changing the aggregation.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import numpy as np

WINDOWS = {"1h": timedelta(hours=1), "12h": timedelta(hours=12), "24h": timedelta(hours=24)}
MAX_SPAN = timedelta(days=31)
CELL_M = 0.15
MAX_CELLS_PER_SIDE = 400
MIN_SIGMA_M = 0.3
MAX_SIGMA_M = 1.5
PADDING_M = 0.5
# Field-of-view estimates: Ring's default lens, a soft edge, and a lower peak than
# a positioned sighting so exact positions stand out where both exist.
DEFAULT_FOV_DEGREES = 110
FOV_EDGE_DEGREES = 8
ESTIMATE_WEIGHT = 0.5


def parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def resolve_range(window: str | None, since: str | None, until: str | None, now: datetime | None = None):
    """Turn a preset or an explicit range into ``(since, until)``; raises ValueError."""
    now = now or datetime.now(timezone.utc)
    end = parse_time(until) if until else now
    if since:
        start = parse_time(since)
    else:
        if (window or "24h") not in WINDOWS:
            raise ValueError(f"window must be one of {', '.join(WINDOWS)}")
        start = end - WINDOWS[window or "24h"]
    if start >= end:
        raise ValueError("since must be before until")
    if end - start > MAX_SPAN:
        raise ValueError("the time range can be at most 31 days")
    return start, end


def sample_time(incident: dict, observation: dict) -> datetime | None:
    """When the sighting happened in real time.

    Live incidents carry real clock times. Replays keep the fixture's own
    timestamps, so they are re-anchored so the replay's last sighting falls at
    the moment the incident was recorded, with the original spacing kept.
    """
    try:
        if incident.get("evidence_mode") == "live":
            return parse_time(observation["observed_at"])
        created = parse_time(incident["created_at"])
        last = max(parse_time(o["observed_at"]) for o in incident["observations"])
        return created + (parse_time(observation["observed_at"]) - last)
    except (KeyError, ValueError, TypeError):
        return None


def layout_bounds(layout: dict):
    xs, ys = [], []
    for room in layout.get("rooms", []):
        for x, y in room["polygon_xy_m"]:
            xs.append(x)
            ys.append(y)
    for camera in layout.get("cameras", []):
        cx, cy = camera["position_m"][:2]
        reach = camera.get("range_m", 0)
        xs += [cx - reach, cx + reach]
        ys += [cy - reach, cy + reach]
    if not xs:
        return None
    return min(xs) - PADDING_M, min(ys) - PADDING_M, max(xs) + PADDING_M, max(ys) + PADDING_M


def _smoothstep(value):
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3 - 2 * value)


def fov_footprint(camera: dict, centres_x, centres_y):
    """Where a person who set off this camera probably stood: its view wedge.

    Full weight across the wedge, fading over a few degrees at its sides, near
    the lens, and just past the camera's range; slightly denser close to the
    camera, where motion sensors trigger most readily. Peak is 1.
    """
    px, py = camera["position_m"][:2]
    reach = max(0.5, float(camera.get("range_m", 4)))
    half = math.radians(float(camera.get("fov_degrees") or DEFAULT_FOV_DEGREES)) / 2
    edge = math.radians(FOV_EDGE_DEGREES)
    dx = centres_x[None, :] - px
    dy = centres_y[:, None] - py
    distance = np.hypot(dx, dy)
    turn = np.angle(np.exp(1j * (np.arctan2(dy, dx) - math.radians(float(camera.get("heading_degrees", 0))))))
    across = _smoothstep((half + edge - np.abs(turn)) / (2 * edge))
    ratio = distance / reach
    along = _smoothstep(ratio / 0.12) * _smoothstep((1.1 - ratio) / 0.2) * (1 - 0.4 * np.minimum(ratio, 1))
    footprint = across * along
    peak = float(footprint.max())
    return footprint / peak if peak > 0 else footprint


def build_heatmap(site: dict, incidents: list[dict], since: datetime, until: datetime) -> dict:
    layout = site["layout"]
    bounds = layout_bounds(layout)
    floor_ids = {floor["id"] for floor in layout.get("floors", [])}
    cameras = {camera["id"]: camera for camera in layout.get("cameras", []) if camera.get("id")}
    points: list[tuple[float, float, float]] = []
    estimated: dict[str, int] = {}
    unpositioned: dict[str, int] = {}
    for incident in incidents:
        for observation in incident.get("observations", []):
            when = sample_time(incident, observation)
            if when is None or not (since <= when <= until):
                continue
            location = observation.get("location", {})
            if location.get("kind") == "floor_point" and (not floor_ids or location.get("floor_id") in floor_ids):
                x, y = location["xy_m"][:2]
                sigma = min(MAX_SIGMA_M, max(MIN_SIGMA_M, 0.75 * float(location.get("uncertainty_radius_m", 0))))
                points.append((float(x), float(y), sigma))
            elif observation.get("category") != "coverage_gap":
                source = observation.get("source_id") or "unknown"
                bucket = estimated if source in cameras else unpositioned
                bucket[source] = bucket.get(source, 0) + 1

    result = {
        "site_id": site["id"],
        "since": since.isoformat().replace("+00:00", "Z"),
        "until": until.isoformat().replace("+00:00", "Z"),
        "samples": 0,
        "estimated": 0,
        "estimated_cameras": [{"camera_id": k, "events": v} for k, v in sorted(estimated.items())],
        "cell_m": CELL_M,
        "origin_xy_m": [0.0, 0.0],
        "columns": 0,
        "rows": 0,
        "values": [],
        "unpositioned": [{"camera_id": k, "events": v} for k, v in sorted(unpositioned.items())],
    }
    if bounds is None:
        return result
    x0, y0, x1, y1 = bounds
    # Keep the grid bounded for very large sites by coarsening the cells.
    cell = max(CELL_M, (x1 - x0) / MAX_CELLS_PER_SIDE, (y1 - y0) / MAX_CELLS_PER_SIDE)
    columns = max(1, math.ceil((x1 - x0) / cell))
    rows = max(1, math.ceil((y1 - y0) / cell))
    grid = np.zeros((rows, columns), dtype=np.float64)
    centres_x = x0 + (np.arange(columns) + 0.5) * cell
    centres_y = y0 + (np.arange(rows) + 0.5) * cell
    kept = 0
    for x, y, sigma in points:
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            continue
        kept += 1
        reach = 3 * sigma
        c0, c1 = max(0, int((x - reach - x0) / cell)), min(columns, int((x + reach - x0) / cell) + 1)
        r0, r1 = max(0, int((y - reach - y0) / cell)), min(rows, int((y + reach - y0) / cell) + 1)
        dx = centres_x[c0:c1] - x
        dy = centres_y[r0:r1] - y
        grid[r0:r1, c0:c1] += np.exp(-(dy[:, None] ** 2 + dx[None, :] ** 2) / (2 * sigma * sigma))
    for camera_id, events in estimated.items():
        grid += ESTIMATE_WEIGHT * events * fov_footprint(cameras[camera_id], centres_x, centres_y)
    guessed = sum(estimated.values())
    peak = float(grid.max()) if kept or guessed else 0.0
    if peak > 0:
        grid /= peak
    else:
        kept = guessed = 0
    result.update(
        samples=kept,
        estimated=guessed,
        cell_m=round(cell, 4),
        origin_xy_m=[round(x0, 4), round(y0, 4)],
        columns=columns,
        rows=rows,
        # Row-major from the minimum y upward; three decimals keep payloads small.
        values=[round(v, 3) for v in grid.ravel().tolist()] if peak > 0 else [],
    )
    return result
