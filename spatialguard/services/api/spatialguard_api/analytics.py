"""Site Analytics: the foot-traffic numbers a business owner acts on.

Built from a site's incidents, where one incident is one visit, together
with:

* the positioned sightings in those incidents;
* the person paths detected in Ring recordings (tracks.py);
* one estimated dot for an event whose recording has not been analyzed.

Everything is reported in the owner's time zone, and the last 7 days are
compared with the 7 days before them.

Definitions:

* A **visit** is an incident with at least one counted observation. Coverage
  gaps and events whose recording showed no person are not counted.
* A visit's **time** is when it started. Its **entrance** is the camera that
  saw it first.
* **Zones** are the map's zones and rooms; areas with the same name (two
  "Porch" zones) are combined. A point in no area counts as "Outside".
* **Dwell** is the time between consecutive sightings of the same visit in
  the same zone, ignoring gaps longer than 15 seconds.

Positions are estimates unless cameras are calibrated. ``quality`` says how
many visits come from detected paths, positioned sightings or estimates.

Everything is computed per site, so ``overview`` can summarize several sites
side by side as the product grows past one location.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .heatmap import event_points, sample_time

PERIOD_DAYS = 7
DWELL_GAP_S = 15
OUTSIDE = "Outside"


def zone_info(name: str | None) -> ZoneInfo | timezone:
    """The owner's IANA time zone, or UTC when missing or unknown."""
    try:
        return ZoneInfo(name) if name else timezone.utc
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def _areas(layout: dict) -> list[tuple[str, list[list[tuple[float, float]]]]]:
    """(name, polygons) with zones before rooms, since zones are the more specific areas."""
    grouped: dict[str, list] = {}
    for area in [*layout.get("zones", []), *layout.get("rooms", [])]:
        polygon = [(float(x), float(y)) for x, y in area["polygon_xy_m"]]
        grouped.setdefault(area["name"].strip() or "Unnamed area", []).append(polygon)
    return list(grouped.items())


def _inside(x: float, y: float, polygon) -> bool:
    hit = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            hit = not hit
        j = i
    return hit


def _zone(x: float, y: float, areas) -> str:
    for name, polygons in areas:
        if any(_inside(x, y, polygon) for polygon in polygons):
            return name
    return OUTSIDE


def visits(site: dict, incidents: list[dict], tracks: dict) -> list[dict]:
    """Every visit at the site: start time, entrance camera, zone samples and data kind."""
    layout = site["layout"]
    cameras = {c["id"]: c for c in layout.get("cameras", []) if c.get("id")}
    areas = _areas(layout)
    result = []
    for incident in incidents:
        counted, samples, kinds = [], [], set()
        for observation in incident.get("observations", []):
            if observation.get("category") == "coverage_gap":
                continue
            when = sample_time(incident, observation)
            if when is None:
                continue
            location = observation.get("location", {})
            camera = cameras.get(observation.get("source_id"))
            if location.get("kind") == "floor_point":
                x, y = location["xy_m"][:2]
                samples.append((when, _zone(float(x), float(y), areas)))
                kinds.add("positioned")
            elif camera:
                kind, path = event_points(incident, observation, camera, tracks)
                if kind == "none":
                    continue  # The recording showed no person.
                kinds.add(kind)
                samples.extend((when + timedelta(seconds=t), _zone(x, y, areas)) for t, x, y in path)
            counted.append((when, observation.get("source_id")))
        if not counted:
            continue
        counted.sort(key=lambda item: item[0])
        samples.sort(key=lambda item: item[0])
        kind = "tracked" if "tracked" in kinds else "positioned" if "positioned" in kinds else "estimated"
        result.append({"start": counted[0][0], "entrance": counted[0][1], "samples": samples, "kind": kind})
    return result


def _dwell(samples) -> dict[str, float]:
    spent: dict[str, float] = defaultdict(float)
    for (t1, zone1), (t2, zone2) in zip(samples, samples[1:]):
        gap = (t2 - t1).total_seconds()
        if zone1 == zone2 and 0 < gap <= DWELL_GAP_S:
            spent[zone1] += gap
    return spent


def _change(now: float, before: float) -> float | None:
    return None if not before else round((now - before) / before * 100, 1)


def _mean(values) -> float | None:
    values = list(values)
    return round(sum(values) / len(values), 1) if values else None


def _period_stats(period: list[dict], zone_names: list[str], tz) -> dict:
    hourly = [0] * 24
    zone_visits: dict[str, int] = defaultdict(int)
    zone_dwell: dict[str, list[float]] = defaultdict(list)
    entrances: dict[str, int] = defaultdict(int)
    durations = []
    for visit in period:
        hourly[visit["start"].astimezone(tz).hour] += 1
        entrances[visit["entrance"] or "unknown"] += 1
        for zone in {zone for _, zone in visit["samples"]}:
            zone_visits[zone] += 1
        for zone, seconds in _dwell(visit["samples"]).items():
            zone_dwell[zone].append(seconds)
        if len(visit["samples"]) > 1:
            span = (visit["samples"][-1][0] - visit["samples"][0][0]).total_seconds()
            if 0 < span <= 3600:
                durations.append(span)
    return {"hourly": hourly, "zone_visits": zone_visits, "zone_dwell": zone_dwell,
            "entrances": entrances, "avg_visit_s": _mean(durations)}


def build(site: dict, incidents: list[dict], tracks: dict, tz_name: str | None = None,
          now: datetime | None = None, layout_changes: list[str] | None = None) -> dict:
    tz = zone_info(tz_name)
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    # Whole local days: this period is the 7 days ending with today.
    today = now.astimezone(tz).date()
    first_day = today - timedelta(days=PERIOD_DAYS - 1)
    start = datetime.combine(first_day, datetime.min.time(), tz).astimezone(timezone.utc)
    previous_start = start - timedelta(days=PERIOD_DAYS)
    end = now
    everything = visits(site, incidents, tracks)
    current = [v for v in everything if start <= v["start"] <= end]
    previous = [v for v in everything if previous_start <= v["start"] < start]

    areas = [name for name, _ in _areas(site["layout"])]
    this, last = _period_stats(current, areas, tz), _period_stats(previous, areas, tz)

    days = [first_day + timedelta(days=i) for i in range(PERIOD_DAYS)]
    daily_now = defaultdict(int)
    grid = [[0] * 24 for _ in days]
    for visit in current:
        local = visit["start"].astimezone(tz)
        index = (local.date() - first_day).days
        if 0 <= index < PERIOD_DAYS:
            daily_now[index] += 1
            grid[index][local.hour] += 1
    daily_before = defaultdict(int)
    # Same day-and-hour layout for the previous period, aligned by weekday.
    grid_before = [[0] * 24 for _ in days]
    for visit in previous:
        local = visit["start"].astimezone(tz)
        index = (local.date() - (first_day - timedelta(days=PERIOD_DAYS))).days
        if 0 <= index < PERIOD_DAYS:
            daily_before[index] += 1
            grid_before[index][local.hour] += 1

    names = list(dict.fromkeys([*areas, *this["zone_visits"], *last["zone_visits"]]))
    zones = [{
        "name": name,
        "visits": this["zone_visits"].get(name, 0),
        "previous": last["zone_visits"].get(name, 0),
        "dwell_s": _mean(this["zone_dwell"].get(name, [])),
        "dwell_previous_s": _mean(last["zone_dwell"].get(name, [])),
    } for name in names if name != OUTSIDE or this["zone_visits"].get(name) or last["zone_visits"].get(name)]
    zones.sort(key=lambda zone: (-zone["visits"], zone["name"]))
    active = [zone for zone in zones if zone["visits"]]

    camera_names = {c["id"]: c["name"] for c in site["layout"].get("cameras", [])}
    entrance_ids = list(dict.fromkeys([*this["entrances"], *last["entrances"]]))
    entrances = sorted(({
        "camera_id": camera_id,
        "name": camera_names.get(camera_id, "Removed camera"),
        "visits": this["entrances"].get(camera_id, 0),
        "previous": last["entrances"].get(camera_id, 0),
    } for camera_id in entrance_ids), key=lambda item: -item["visits"])

    peak = max(range(24), key=lambda hour: this["hourly"][hour]) if current else None
    quiet_hours = [h for h in range(24) if this["hourly"][h]]
    quality = defaultdict(int)
    for visit in current:
        quality[visit["kind"]] += 1

    return {
        "site_id": site["id"],
        "site_name": site.get("name", ""),
        "time_zone": getattr(tz, "key", "UTC"),
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "period": {
            "since": start.isoformat().replace("+00:00", "Z"),
            "until": end.isoformat().replace("+00:00", "Z"),
            "previous_since": previous_start.isoformat().replace("+00:00", "Z"),
            "days": PERIOD_DAYS,
        },
        "totals": {
            "visits": len(current),
            "previous": len(previous),
            "change_pct": _change(len(current), len(previous)),
            "avg_visit_s": this["avg_visit_s"],
            "avg_visit_previous_s": last["avg_visit_s"],
            "peak_hour": peak,
            "peak_hour_visits": this["hourly"][peak] if peak is not None else 0,
            "busiest_zone": active[0]["name"] if active else None,
            "quietest_zone": min(zones, key=lambda z: (z["visits"], z["name"]))["name"] if len(zones) > 1 else None,
            "first_hour": quiet_hours[0] if quiet_hours else None,
            "last_hour": quiet_hours[-1] if quiet_hours else None,
        },
        "daily": [{
            "date": day.isoformat(),
            "visits": daily_now.get(i, 0),
            "previous": daily_before.get(i, 0),
        } for i, day in enumerate(days)],
        "hourly": [{"hour": h, "visits": this["hourly"][h], "previous": last["hourly"][h]} for h in range(24)],
        "week_grid": grid,
        "week_grid_previous": grid_before,
        "zones": zones,
        "entrances": entrances,
        "quality": {"tracked": quality["tracked"], "positioned": quality["positioned"], "estimated": quality["estimated"]},
        "layout_changes": sorted(layout_changes or []),
    }


def overview(summaries: list[dict]) -> list[dict]:
    """One row per site for the site switcher; ready for a multi-site portfolio."""
    return [{
        "site_id": s["site_id"],
        "name": s["site_name"],
        "visits": s["totals"]["visits"],
        "previous": s["totals"]["previous"],
        "change_pct": s["totals"]["change_pct"],
        "peak_hour": s["totals"]["peak_hour"],
        "busiest_zone": s["totals"]["busiest_zone"],
    } for s in summaries]
