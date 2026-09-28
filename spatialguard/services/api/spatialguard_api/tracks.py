"""Person paths detected in Ring event recordings, analyzed automatically.

Every live Ring event from a monitored camera is queued here when its incident
is recorded. A background thread fetches that event's recording through the
same authorization as playback, runs the YOLO person detector, and keeps only
the detected foot points (image coordinates, 0..1) for the people heatmap and
Site Analytics. The recording itself is written to private scratch space only
for the detector and deleted straight away; the points are deleted with their
incident.

Owners who open a recording in the review screen produce the same result
through the on-demand ``/track`` route, which saves it here too.
"""

from __future__ import annotations

import json
import logging
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException

from .person_tracking import MODEL, PersonDetectorUnavailable, track_video
from .store import DATA, account_preferences, now

log = logging.getLogger(__name__)

# Ring needs a little time after an event before its recording can be fetched.
QUEUE_DELAY_S = 45
RETRY_DELAYS_S = (90, 240, 600)
LEASE_S = 300
# Enough for a one-minute clip at ~4 points a second.
MAX_POINTS = 240
MIN_STEP_S = 0.25


def _at(value: str) -> float:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return time.time()


def enqueue(db, incident_id: str, observation_id: str, site_id: str, camera_id: str, observed_at: str) -> None:
    """Queue one live event for automatic analysis (idempotent)."""
    db.execute(
        "INSERT OR IGNORE INTO observation_tracks"
        "(incident_id, observation_id, site_id, camera_id, observed_at, state, attempts, not_before, updated) "
        "VALUES (?,?,?,?,?,'queued',0,?,?)",
        (incident_id, observation_id, site_id, camera_id, observed_at, _at(observed_at) + QUEUE_DELAY_S, now()),
    )


def compact(points) -> list[list[float]]:
    """[t, foot_x, foot_y, confidence] rows, thinned to a steady rate and bounded."""
    rows, last = [], None
    for p in points:
        t = float(p.t_seconds)
        if last is not None and t - last < MIN_STEP_S:
            continue
        rows.append([round(t, 2), round(float(p.foot_x_norm), 4), round(float(p.foot_y_norm), 4), round(float(p.confidence), 3)])
        last = t
    if len(rows) > MAX_POINTS:
        stride = len(rows) / MAX_POINTS
        rows = [rows[int(i * stride)] for i in range(MAX_POINTS)]
    return rows


def save(db, incident_id: str, observation_id: str, site_id: str, camera_id: str, observed_at: str, track, detector: str = "") -> None:
    points = compact(track.points)
    db.execute(
        "INSERT INTO observation_tracks"
        "(incident_id, observation_id, site_id, camera_id, observed_at, state, attempts, not_before, points, detector, updated) "
        "VALUES (?,?,?,?,?,?,0,0,?,?,?) "
        "ON CONFLICT(incident_id, observation_id) DO UPDATE SET state=excluded.state, points=excluded.points, "
        "detector=excluded.detector, updated=excluded.updated, lease=NULL",
        (incident_id, observation_id, site_id, camera_id, observed_at, "done" if points else "no_person",
         json.dumps(points), detector or track.detector, now()),
    )


def load(db, site_id: str) -> dict[tuple[str, str], dict]:
    """(incident id, observation id) -> {"state", "points"} for one site."""
    result = {}
    for r in db.execute("SELECT incident_id, observation_id, state, points FROM observation_tracks WHERE site_id=?", (site_id,)):
        points = json.loads(r["points"]) if r["points"] else []
        result[(r["incident_id"], r["observation_id"])] = {"state": r["state"], "points": points}
    return result


def _finish(store, row, state: str, retry: bool = False) -> None:
    with store.connect() as db:
        if retry and row["attempts"] <= len(RETRY_DELAYS_S):
            delay = RETRY_DELAYS_S[min(row["attempts"], len(RETRY_DELAYS_S)) - 1]
            db.execute("UPDATE observation_tracks SET state='queued', lease=NULL, not_before=?, updated=? "
                       "WHERE incident_id=? AND observation_id=?",
                       (time.time() + delay, now(), row["incident_id"], row["observation_id"]))
        else:
            db.execute("UPDATE observation_tracks SET state=?, lease=NULL, updated=? WHERE incident_id=? AND observation_id=?",
                       (state, now(), row["incident_id"], row["observation_id"]))


def process_one(ring, store) -> bool:
    """Analyze the next due event. Returns False when nothing is due."""
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        found = db.execute(
            "SELECT * FROM observation_tracks WHERE (state='queued' AND not_before<=?) "
            "OR (state='running' AND lease<?) ORDER BY not_before LIMIT 1",
            (time.time(), time.time()),
        ).fetchone()
        if not found:
            return False
        row = dict(found)
        row["attempts"] += 1
        db.execute("UPDATE observation_tracks SET state='running', lease=?, attempts=? WHERE incident_id=? AND observation_id=?",
                   (time.time() + LEASE_S, row["attempts"], row["incident_id"], row["observation_id"]))
        owner = db.execute("SELECT owner FROM sites WHERE id=?", (row["site_id"],)).fetchone()
        consent = bool(owner) and account_preferences(db, owner["owner"])["ring_data_consent"]
    if not owner or not consent:
        _finish(store, row, "skipped")
        return True
    if not MODEL.is_file():
        _finish(store, row, "unavailable")
        return True
    try:
        media, _ = ring.incident_clip(owner["owner"], row["incident_id"], row["observation_id"])
    except HTTPException as error:
        # No longer authorized (unlinked, remapped, deleted): never retry.
        _finish(store, row, "failed", retry=error.status_code >= 500)
        return True
    except Exception as error:
        # Usually the recording is not ready yet; retry on a widening schedule.
        log.info("Recording not available for analysis yet: %s", type(error).__name__)
        _finish(store, row, "failed", retry=True)
        return True
    directory = DATA / "transient-recordings"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        # OpenCV needs a seekable file; the scratch copy is removed on success or error.
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            path = Path(temporary) / "clip.mp4"
            path.write_bytes(media)
            track = track_video(row["observation_id"], path)
    except PersonDetectorUnavailable:
        _finish(store, row, "failed", retry=True)
        return True
    finally:
        del media
    with store.connect() as db:
        exists = db.execute("SELECT 1 FROM incidents WHERE id=?", (row["incident_id"],)).fetchone()
        if exists:
            save(db, row["incident_id"], row["observation_id"], row["site_id"], row["camera_id"], row["observed_at"], track)
            # A detected path can place the visitor in a zone that is now busy.
            from . import alerts
            alerts.try_evaluate(db, row["site_id"])
        else:
            db.execute("DELETE FROM observation_tracks WHERE incident_id=?", (row["incident_id"],))
    return True


def run_forever(ring, store, stop: threading.Event | None = None) -> None:
    """Background loop for the worker process; one recording at a time."""
    while not (stop and stop.is_set()):
        try:
            busy = process_one(ring, store)
        except Exception as error:  # Never let one bad job stop analysis.
            log.warning("Automatic person analysis failed: %s", type(error).__name__)
            busy = False
        if not busy:
            time.sleep(3)
