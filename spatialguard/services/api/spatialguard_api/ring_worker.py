"""Create honest event-level incidents. A webhook never establishes a floor coordinate."""
import json
import time
from datetime import datetime
from .models import Association, Incident
from twinforge.models import Observation
from .store import event, now
from .classifier import classify_image

LIVE_INCIDENT_WINDOW_SECONDS = 5 * 60


def _at(value):
    return datetime.fromisoformat(value).timestamp()


def _candidate_incident(db, site_id, revision_id, observation):
    """Find the newest live incident whose total event span stays within five minutes."""
    at = _at(observation.observed_at.isoformat())
    rows = db.execute(
        "SELECT id,data FROM incidents WHERE site_id=? ORDER BY seq DESC LIMIT 100",
        (site_id,),
    ).fetchall()
    for row in rows:
        candidate = Incident.model_validate_json(row['data'])
        if candidate.evidence_mode != 'live' or candidate.revision_id != revision_id:
            continue
        times = [_at(item.observed_at.isoformat()) for item in candidate.observations]
        if times and max(max(times), at) - min(min(times), at) <= LIVE_INCIDENT_WINDOW_SECONDS:
            return row['id'], candidate
    return None, None


def _associations(observations):
    """Associate only consecutive observations from different cameras."""
    result = []
    for previous, current in zip(observations, observations[1:]):
        if previous.source_id == current.source_id:
            continue
        gap = max(0, _at(current.observed_at.isoformat()) - _at(previous.observed_at.isoformat()))
        result.append(Association(
            from_observation_id=previous.observation_id,
            to_observation_id=current.observation_id,
            reason=("Different mapped Ring cameras reported activity within the five-minute "
                    "incident window. This is a possible continuation only; identity and the "
                    "movement during the unobserved gap are unknown."),
            unobserved_gap_seconds=gap,
        ))
    return result


def _merge_incident(incident, observation, classification, classification_status):
    if all(item.observation_id != observation.observation_id for item in incident.observations):
        incident.observations.append(observation)
    incident.observations.sort(key=lambda item: item.observed_at)
    incident.associations = _associations(incident.observations)
    incident.started_at = min(item.observed_at for item in incident.observations).isoformat()
    incident.status = 'needs_review'
    incident.reviewed_at = None
    if classification:
        incident.classification = classification
        incident.classification_status = 'completed'
    elif incident.classification is None and classification_status == 'unavailable':
        incident.classification_status = 'unavailable'
    cameras = len({item.source_id for item in incident.observations})
    incident.title = ((incident.classification.display_label + f' across {cameras} cameras')
                      if incident.classification and cameras > 1 else
                      (f'Activity across {cameras} Ring cameras' if cameras > 1 else incident.title))
    incident.rule = (
        f'{len(incident.observations)} Ring events from {cameras} selected camera'
        f'{"s" if cameras != 1 else ""} were grouped within a fixed five-minute window. '
        'Cross-camera links are possible continuations; position, identity, and movement '
        'between observations remain unknown.'
    )
    return incident


def process_one(service, engine, classifier=classify_image):
    store = service.store
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        r = db.execute("SELECT * FROM ring_inbox WHERE state='queued' OR (state='running' AND lease<?) ORDER BY rowid LIMIT 1", (time.time(),)).fetchone()
        if not r: return False
        row = dict(r)
        db.execute("UPDATE ring_inbox SET state='running',lease=?,attempts=attempts+1 WHERE id=?", (time.time()+90, row['id']))
    try:
        snapshot = json.loads(row['snapshot']) if row['snapshot'] else None
        def current(db):
            if not snapshot or row['kind'] not in ('motion_detected','button_press'): return False
            a = db.execute("SELECT 1 FROM ring_accounts WHERE account=? AND state='connected' AND generation=?", (row['account'], snapshot['generation'])).fetchone()
            s = db.execute('SELECT data FROM sites WHERE id=?', (snapshot['site'],)).fetchone()
            d = db.execute('SELECT 1 FROM ring_devices WHERE account=? AND device=? AND site=? AND camera=?', (row['account'], row['device'], snapshot['site'], snapshot['camera'])).fetchone()
            if not a or not s or not d: return False
            site = json.loads(s[0])
            return site['monitoring']['enabled'] and site.get('monitoring_version',0) == snapshot['monitoring_version'] and snapshot['camera'] in site['monitoring']['camera_ids']
        with store.connect() as db:
            active = current(db)
        if not active:
            with store.connect() as db:
                db.execute("UPDATE ring_inbox SET state='ignored' WHERE id=?", (row['id'],))
            return True
        classification = None
        classification_status = 'not_requested'
        with store.connect() as db:
            site_row = db.execute('SELECT data FROM sites WHERE id=?', (snapshot['site'],)).fetchone()
            account_row = db.execute(
                "SELECT owner FROM ring_accounts WHERE account=? AND state='connected'",
                (row['account'],),
            ).fetchone()
        site = json.loads(site_row[0])
        if site['monitoring'].get('classification_enabled', False):
            classification_status = 'unavailable'
            try:
                image, media_type, _ = service.snapshot(
                    account_row['owner'], snapshot['site'], snapshot['camera']
                )
                classification = classifier(image, media_type)
                classification_status = 'completed'
            except Exception:
                # A classifier or snapshot outage must not discard the signed event.
                classification = None
        obs = Observation(observation_id='ring_'+row['id'][:40], site_id=snapshot['site'], revision_id=snapshot['revision'],
            source_id=snapshot['camera'], observed_at=row['at'], received_at=row['received'], category=row['kind'],
            location={'kind':'unknown','reason':'Ring event metadata supplies no calibrated person location. Camera placement does not locate the activity.'},
            evidence={'mode':'live'}, provenance={'kind':'measured','confirmed':False,
                'explanation':'Signed official Ring webhook: '+row['kind']+'. Provider subtype: '+(row['subtype'] or 'unspecified')+'. No video analysis or identity inference.'})
        engine.observations([obs.model_dump(mode='json')])
        title = (classification.display_label if classification else
                 ('Ring doorbell pressed' if row['kind']=='button_press' else 'Ring motion reported'))
        rule = ('Luna classified one event snapshot; the result is an AI interpretation that requires review. '
                'Position and identity remain unknown.' if classification else
                'Ring event from a selected camera while monitoring is enabled. Position and person identity are unknown.')
        incident = Incident(id='incident_ring_'+row['id'][:40], site_id=snapshot['site'], revision_id=snapshot['revision'],
            run_id='ring_'+row['id'][:40], title=title, rule=rule,
            started_at=row['at'], created_at=row['received'], evidence_mode='live', observations=[obs], associations=[], evidence_ids=[],
            classification_status=classification_status, classification=classification)
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if current(db):
                existing_id, existing = _candidate_incident(
                    db, incident.site_id, incident.revision_id, obs
                )
                if existing:
                    merged = _merge_incident(
                        existing, obs, classification, classification_status
                    )
                    db.execute('UPDATE incidents SET data=? WHERE id=?',
                               (merged.model_dump_json(), existing_id))
                    event(db, incident.site_id, 'incident.updated', existing_id)
                else:
                    inserted = db.execute('INSERT OR IGNORE INTO incidents(id,site_id,run_id,data) VALUES (?,?,?,?)',
                        (incident.id, incident.site_id, incident.run_id, incident.model_dump_json())).rowcount
                    if inserted: event(db, incident.site_id, 'incident.created', incident.id)
            db.execute("UPDATE ring_inbox SET state='succeeded' WHERE id=?", (row['id'],))
    except Exception:
        with store.connect() as db:
            db.execute('UPDATE ring_inbox SET state=?,lease=? WHERE id=?', ('failed' if row['attempts']>=2 else 'running',time.time()+5,row['id']))
    return True
