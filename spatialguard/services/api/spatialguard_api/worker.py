"""Durable replay worker. Engine ingestion uses deterministic immutable IDs."""
import json
import time
from datetime import datetime
from .store import Store, cleanup_retention, dump, event, now
from .models import Incident, Association, EvidenceAsset
from .engine import client


def process_one(store, engine):
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM runs WHERE state='queued' OR (state='running' AND lease<?) ORDER BY rowid LIMIT 1", (time.time(),)).fetchone()
        if not row:
            return False
        run = dict(row)
        db.execute("UPDATE runs SET state='running',lease=?,attempts=attempts+1 WHERE id=?", (time.time()+600, run["id"]))
        site = json.loads(db.execute("SELECT data FROM sites WHERE id=?", (run["site_id"],)).fetchone()[0])
    try:
        payload = json.loads(run["payload"])
        with store.connect() as db:
            current = json.loads(db.execute("SELECT data FROM sites WHERE id=?", (site["id"],)).fetchone()[0])
        if not current["monitoring"]["enabled"] or current.get("monitoring_version", 0) != payload.get("monitoring_version", 0) or current["monitoring"]["camera_ids"] != payload["camera_ids"]:
            with store.connect() as db:
                db.execute("UPDATE runs SET state='paused',error='Monitoring changed before processing' WHERE id=?", (run["id"],))
                event(db, site["id"], "replay.paused", run["id"])
            return True
        observations = payload["observations"]
        engine.observations(observations)
        rooms = {}
        for observation in observations:
            loc = observation["location"]
            if loc["kind"] == "floor_point":
                result = engine.query(site["revision_id"], {"kind": "room", "floor_id": loc["floor_id"],
                    "xy_m": loc["xy_m"], "uncertainty_radius_m": loc["uncertainty_radius_m"]})
                rooms[observation["observation_id"]] = result["ids"]
        # Rule is deliberately narrow: observed activity in the synthetic approach/hall.
        triggered = any(set(ids) & {"room_approach", "room_hall"} for ids in rooms.values())
        associations = []
        previous = None
        for obs in observations:
            if obs["location"]["kind"] == "unknown":
                continue
            if previous and previous["source_id"] != obs["source_id"]:
                a, b = rooms.get(previous["observation_id"], []), rooms.get(obs["observation_id"], [])
                gap = (datetime.fromisoformat(obs["observed_at"].replace("Z", "+00:00"))-datetime.fromisoformat(previous["observed_at"].replace("Z", "+00:00"))).total_seconds()
                adjacent = any({p["from_room_id"], p["to_room_id"]} == {a[0], b[0]} for p in site["layout"]["portals"]) if len(a) == len(b) == 1 else False
                if adjacent and 0 < gap <= 15:
                    associations.append(Association(from_observation_id=previous["observation_id"], to_observation_id=obs["observation_id"],
                        reason="Adjacent spaces and compatible timestamps; identity is unknown and the gap is unobserved.", unobserved_gap_seconds=gap))
            previous = obs
        incident_id = "incident_" + run["id"]
        assets = [EvidenceAsset(id="evidence_"+o["observation_id"], incident_id=incident_id,
            observation_id=o["observation_id"], description="Synthetic replay illustration, not camera footage")
            for o in observations if o["location"]["kind"] != "unknown"]
        incident = Incident(id=incident_id, site_id=site["id"], revision_id=site["revision_id"], run_id=run["id"],
            title="Activity observed near the entry", rule="Person activity in Front approach or Hallway while monitoring is enabled",
            started_at=observations[0]["observed_at"], created_at=payload["created_at"], observations=observations,
            associations=associations, evidence_ids=[a.id for a in assets])
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = json.loads(db.execute("SELECT data FROM sites WHERE id=?", (site["id"],)).fetchone()[0])
            if not current["monitoring"]["enabled"] or current.get("monitoring_version", 0) != payload.get("monitoring_version", 0) or current["monitoring"]["camera_ids"] != payload["camera_ids"]:
                db.execute("UPDATE runs SET state='paused',error='Monitoring changed; incident creation stopped' WHERE id=?", (run["id"],))
                event(db, site["id"], "replay.paused", run["id"])
                return True
            if triggered:
                inserted = db.execute("INSERT OR IGNORE INTO incidents(id,site_id,run_id,data) VALUES (?,?,?,?)", (incident.id, site["id"], run["id"], incident.model_dump_json())).rowcount
                for asset in assets:
                    db.execute("INSERT OR IGNORE INTO evidence VALUES (?,?,?)", (asset.id, site["id"], asset.model_dump_json()))
                if inserted:
                    event(db, site["id"], "incident.created", incident.id)
            db.execute("UPDATE runs SET state='succeeded',error=NULL WHERE id=?", (run["id"],))
            event(db, site["id"], "replay.completed", run["id"])
    except Exception:
        # Provider response bodies and credentials must not enter the UI/logs.
        with store.connect() as db:
            state = "failed" if run["attempts"] >= 2 else "running"
            db.execute("UPDATE runs SET state=?,lease=?,error=? WHERE id=?", (state, time.time()+5,
                "TwinForge processing unavailable. Check the engine and retry replay.", run["id"]))
            event(db, run["site_id"], "replay.retry" if state == "running" else "replay.failed", run["id"])
    return True


def main():
    store, engine = Store(), client()
    from .ring_service import RingService
    from .ring_worker import process_one as ring_process
    ring = RingService(store)
    cleanup_at = 0
    retention_at = 0
    while True:
        if time.time() >= cleanup_at:
            ring.cleanup()
            cleanup_at = time.time()+2
        if time.time() >= retention_at:
            cleanup_retention(store)
            retention_at = time.time()+3600
        live = ring_process(ring, engine)
        if not process_one(store, engine) and not live:
            time.sleep(.5)


if __name__ == "__main__":
    main()
