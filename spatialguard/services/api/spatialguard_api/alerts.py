"""Queue and crowding alerts: event-based triggers from people in a zone.

Every time new activity arrives, meaning a Ring event, a detected path or a
demo visit, the site is checked. When a zone has had at least its limit of
distinct visitors within the alert window, an alert is raised. It shows up
live in the apps (through the ``alert.crowding`` site event) and in Site
Analytics.

* **Queue zones** are the places people wait: checkout, counter, register,
  queue, line, till and entrance. Their default limit is lower, and the alert
  reads "Queue building at Checkout".
* **Other zones** alert on crowding, with a higher default limit.

Owners can change each zone's limit or turn it off, and set the window. A zone
does not alert again while an alert from the last 15 minutes is still
unacknowledged, so a busy lunch hour is one alert, not twenty.

Visitor counts come from the same visits as Site Analytics (analytics.py), so
positions are estimates and each visitor counts once per zone.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from . import analytics
from .store import event, now

QUEUE_WORDS = ("checkout", "check-out", "counter", "register", "queue", "line", "till", "entrance", "entry")
DEFAULT_WINDOW_MINUTES = 5
QUEUE_LIMIT = 3
CROWD_LIMIT = 6
COOLDOWN = timedelta(minutes=15)
WINDOWS = (2, 5, 10, 15, 30)
log = logging.getLogger(__name__)


def zone_kind(name: str) -> str:
    lowered = name.lower()
    return "queue" if any(word in lowered for word in QUEUE_WORDS) else "crowding"


def settings(db, site: dict) -> dict:
    """The site's alert settings, with a default limit for every zone on the map."""
    row = db.execute("SELECT data FROM site_alert_settings WHERE site_id=?", (site["id"],)).fetchone()
    saved = json.loads(row["data"]) if row else {}
    limits = saved.get("limits", {})
    zones = []
    for name, _ in analytics._areas(site["layout"]):
        kind = zone_kind(name)
        default = QUEUE_LIMIT if kind == "queue" else CROWD_LIMIT
        zones.append({"name": name, "kind": kind, "limit": limits.get(name, default) if name in limits else default})
    return {"enabled": saved.get("enabled", True), "window_minutes": saved.get("window_minutes", DEFAULT_WINDOW_MINUTES),
            "zones": zones}


def save_settings(db, site: dict, enabled: bool, window_minutes: int, limits: dict[str, int | None]) -> dict:
    known = {name for name, _ in analytics._areas(site["layout"])}
    data = {"enabled": enabled, "window_minutes": window_minutes,
            "limits": {name: limit for name, limit in limits.items() if name in known}}
    db.execute("INSERT INTO site_alert_settings(site_id, data) VALUES (?,?) "
               "ON CONFLICT(site_id) DO UPDATE SET data=excluded.data", (site["id"], json.dumps(data)))
    return settings(db, site)


def occupancy(site: dict, incidents: list[dict], tracks: dict, window: timedelta, at: datetime) -> dict[str, int]:
    """Distinct visitors seen in each zone during the window ending at ``at``."""
    counts: dict[str, int] = {}
    since = at - window
    for visit in analytics.visits(site, incidents, tracks):
        zones = {zone for when, zone in visit["samples"] if since <= when <= at}
        for zone in zones:
            counts[zone] = counts.get(zone, 0) + 1
    return counts


def _recent_incidents(db, site_id: str, since: datetime) -> list[dict]:
    rows = db.execute("SELECT data FROM incidents WHERE site_id=?", (site_id,)).fetchall()
    result = []
    for row in rows:
        incident = json.loads(row["data"])
        try:
            created = datetime.fromisoformat(incident["created_at"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        # Created recently; covers live events and freshly recorded demo visits.
        if created >= since:
            result.append(incident)
    return result


def evaluate(db, site_id: str, at: datetime | None = None) -> list[dict]:
    """Raise alerts for zones at or over their limit. Returns the new alerts."""
    from . import tracks
    at = at or datetime.now(timezone.utc)
    row = db.execute("SELECT data FROM sites WHERE id=?", (site_id,)).fetchone()
    if not row:
        return []
    site = json.loads(row["data"])
    config = settings(db, site)
    if not config["enabled"]:
        return []
    window = timedelta(minutes=config["window_minutes"])
    incidents = _recent_incidents(db, site_id, at - window - timedelta(minutes=2))
    if not incidents:
        return []
    counts = occupancy(site, incidents, tracks.load(db, site_id), window, at)
    raised = []
    for zone in config["zones"]:
        limit, count = zone["limit"], counts.get(zone["name"], 0)
        if not limit or count < limit:
            continue
        recent = db.execute(
            "SELECT id FROM site_alerts WHERE site_id=? AND zone=? AND acknowledged=0 AND at>=?",
            (site_id, zone["name"], (at - COOLDOWN).isoformat())).fetchone()
        if recent:
            continue
        alert = {"site_id": site_id, "zone": zone["name"], "kind": zone["kind"], "count": count, "limit": limit,
                 "window_minutes": config["window_minutes"], "at": at.isoformat()}
        cursor = db.execute(
            "INSERT INTO site_alerts(site_id, zone, kind, count, alert_limit, window_minutes, at, acknowledged) "
            "VALUES (?,?,?,?,?,?,?,0)",
            (site_id, zone["name"], zone["kind"], count, limit, config["window_minutes"], alert["at"]))
        alert["id"] = cursor.lastrowid
        event(db, site_id, "alert.crowding", str(cursor.lastrowid))
        raised.append(alert)
    return raised


def try_evaluate(db, site_id: str) -> list[dict]:
    """Evaluate inside the caller's transaction, never failing the caller's own work."""
    try:
        return evaluate(db, site_id)
    except Exception as error:  # An alert check must not fail or retry a Ring event.
        log.warning("Crowding check failed: %s", type(error).__name__)
        return []


def recent(db, site_id: str, limit: int = 20) -> list[dict]:
    rows = db.execute("SELECT * FROM site_alerts WHERE site_id=? ORDER BY id DESC LIMIT ?", (site_id, limit)).fetchall()
    return [{"id": r["id"], "zone": r["zone"], "kind": r["kind"], "count": r["count"], "limit": r["alert_limit"],
             "window_minutes": r["window_minutes"], "at": r["at"], "acknowledged": bool(r["acknowledged"])} for r in rows]


def live(db, site: dict) -> list[dict]:
    """Zones at or over their limit right now, for the dashboard's live strip."""
    from . import tracks
    config = settings(db, site)
    at = datetime.now(timezone.utc)
    window = timedelta(minutes=config["window_minutes"])
    incidents = _recent_incidents(db, site["id"], at - window - timedelta(minutes=2))
    counts = occupancy(site, incidents, tracks.load(db, site["id"]), window, at) if incidents else {}
    return [{"name": z["name"], "kind": z["kind"], "count": counts.get(z["name"], 0), "limit": z["limit"]}
            for z in config["zones"] if counts.get(z["name"])]
