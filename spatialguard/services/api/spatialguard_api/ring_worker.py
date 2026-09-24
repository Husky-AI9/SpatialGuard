"""Create honest event-level incidents. A webhook never establishes a floor coordinate."""
import json
import logging
import time
from datetime import datetime
from .models import Association, Incident
from twinforge.models import Observation
from .store import account_preferences, digest, event, now
from .classifier import classify_images
from .release import capabilities

LIVE_INCIDENT_WINDOW_SECONDS = 5 * 60
CLASSIFICATION_CAPTURE_WINDOW_SECONDS = 5.5
log = logging.getLogger(__name__)


def _current_site(db, row, snapshot):
    """Recheck the original delivery's authorization without rebinding its evidence."""
    if not snapshot or row['kind'] not in ('motion_detected', 'button_press'):
        return None
    account = db.execute(
        "SELECT owner FROM ring_accounts WHERE account=? AND state='connected' AND generation=?",
        (row['account'], snapshot['generation']),
    ).fetchone()
    if not account:
        return None
    saved = db.execute('SELECT data FROM sites WHERE id=? AND owner=?',
                       (snapshot['site'], account['owner'])).fetchone()
    device = db.execute(
        'SELECT 1 FROM ring_devices WHERE account=? AND device=? AND site=? AND camera=?',
        (row['account'], row['device'], snapshot['site'], snapshot['camera']),
    ).fetchone()
    if not saved or not device or not account_preferences(db, account['owner'])['ring_data_consent']:
        return None
    site = json.loads(saved['data'])
    if (not site['monitoring']['enabled']
            or site.get('monitoring_version', 0) != snapshot['monitoring_version']
            or snapshot['camera'] not in site['monitoring']['camera_ids']):
        return None
    return site


def _bundled_event(db, snapshot, site):
    """An exported demo layout has no corresponding revision in the engine service."""
    return (snapshot['revision'].startswith('rev_demo_bundle_v1_')
            and snapshot['revision'] == site['revision_id']
            and snapshot['camera'] in {camera['id'] for camera in site['layout']['cameras']}
            and db.execute('SELECT 1 FROM settings WHERE key=? AND value=?',
                           ('demo_bundle:' + snapshot['site'], '1')).fetchone() is not None)


def recover_bundled_events(store):
    """One-time repair of retained deliveries affected by the exported-layout bug.

    Keep the original event IDs, timestamps, revision and monitoring generation.
    Paused, revoked, remapped and expired deliveries must never be resurrected.
    """
    key = 'migration:ring_bundled_events_v1'
    recovered = 0
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT 1 FROM settings WHERE key=?', (key,)).fetchone():
            return 0
        rows = db.execute("SELECT i.*,a.owner FROM ring_inbox i JOIN ring_accounts a "
                          "ON a.account=i.account WHERE i.state='failed'").fetchall()
        for row in rows:
            try:
                snapshot = json.loads(row['snapshot']) if row['snapshot'] else None
                site = _current_site(db, row, snapshot)
                retention = account_preferences(db, row['owner'])['incident_retention_days']
                if (not site or not _bundled_event(db, snapshot, site)
                        or _at(row['at']) < time.time() - retention * 86400):
                    continue
            except (KeyError, TypeError, ValueError):
                continue
            db.execute("UPDATE ring_inbox SET state='queued',attempts=0,lease=0,processed=NULL,error=NULL WHERE id=?",
                       (row['id'],))
            recovered += 1
        db.execute('INSERT INTO settings VALUES (?,?)', (key, str(recovered)))
    return recovered


def _at(value):
    return datetime.fromisoformat(value).timestamp()


def _candidate_incident(db, site_id, revision_id, observation, provider_account):
    """Find the newest live incident whose total event span stays within five minutes."""
    at = _at(observation.observed_at.isoformat())
    rows = db.execute(
        "SELECT i.id,i.data,a.account_digest FROM incidents i "
        "JOIN live_incident_accounts a ON a.incident_id=i.id "
        "WHERE i.site_id=? ORDER BY i.seq DESC LIMIT 100",
        (site_id,),
    ).fetchall()
    for row in rows:
        candidate = Incident.model_validate_json(row['data'])
        if (candidate.evidence_mode != 'live' or candidate.revision_id != revision_id
                or row['account_digest'] != digest(provider_account)):
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


def process_one(service, engine, classifier=classify_images):
    store = service.store
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        r = db.execute("SELECT * FROM ring_inbox WHERE state='queued' OR (state='running' AND lease<?) ORDER BY rowid LIMIT 1", (time.time(),)).fetchone()
        if not r: return False
        row = dict(r)
        db.execute("UPDATE ring_inbox SET state='running',lease=?,attempts=attempts+1 WHERE id=?", (time.time()+90, row['id']))
        try:
            queued_ms = max(0, (datetime.now().astimezone() - datetime.fromisoformat(row['received'])).total_seconds() * 1000)
            service._metric(db, row['account'], 'queue_latency_ms', queued_ms)
        except (TypeError, ValueError):
            pass
    try:
        snapshot = json.loads(row['snapshot']) if row['snapshot'] else None
        if row['kind'] in {
            'subscription_activated', 'subscription_deactivated',
            'device_added', 'device_removed', 'device_online', 'device_offline',
            'app_integration_added', 'app_integration_removed',
        }:
            if row['kind'] in {'subscription_activated', 'subscription_deactivated'}:
                service.refresh_subscription(row['account'])
            elif row['kind'] == 'device_added':
                with store.connect() as db:
                    linked = db.execute(
                        "SELECT owner FROM ring_accounts WHERE account=? AND state='connected'",
                        (row['account'],),
                    ).fetchone()
                if linked:
                    service.devices(linked['owner'], True)
            # Removal and connectivity state are applied transactionally by
            # webhook ingestion. The durable worker still records completion
            # so operators can distinguish handled lifecycle events from gaps.
            with store.connect() as db:
                db.execute("UPDATE ring_inbox SET state='succeeded',processed=?,error=NULL WHERE id=?",
                           (now(), row['id']))
            return True
        def current(db):
            return _current_site(db, row, snapshot) is not None
        with store.connect() as db:
            active = current(db)
        if not active:
            with store.connect() as db:
                db.execute("UPDATE ring_inbox SET state='ignored',processed=?,error=NULL WHERE id=?", (now(), row['id']))
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
        with store.connect() as db:
            privacy = account_preferences(db, account_row['owner'])
        if (capabilities()['classification'] and site['monitoring'].get('classification_enabled', False)
                and privacy['ring_data_consent'] and privacy['classification_consent']):
            classification_status = 'unavailable'
            # Webhook acknowledgement is already complete. Briefly defer the
            # durable worker row so Ring has time to expose post-trigger images;
            # do not block this worker or count the deferral as a failed attempt.
            ready_at = _at(row['at']) + CLASSIFICATION_CAPTURE_WINDOW_SECONDS
            delay = ready_at - time.time()
            if 0 < delay <= 10:
                with store.connect() as db:
                    db.execute(
                        "UPDATE ring_inbox SET state='running',lease=?,attempts="
                        "CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END WHERE id=?",
                        (ready_at, row['id']),
                    )
                return True
            try:
                images, media_type = service.event_snapshots(
                    account_row['owner'], snapshot['site'], snapshot['camera'], row['at']
                )
                classification = classifier(images, media_type)
                classification_status = 'completed'
            except Exception:
                # A classifier or snapshot outage must not discard the signed event.
                classification = None
        obs = Observation(observation_id='ring_'+row['id'][:40], site_id=snapshot['site'], revision_id=snapshot['revision'],
            source_id=snapshot['camera'], observed_at=row['at'], received_at=row['received'], category=row['kind'],
            location={'kind':'unknown','reason':'Ring event metadata supplies no calibrated person location. Camera placement does not locate the activity.'},
            evidence={'mode':'live'}, provenance={'kind':'measured','confirmed':False,
                'explanation':'Signed official Ring webhook: '+row['kind']+'. Provider subtype: '+(row['subtype'] or 'unspecified')+'. No video analysis or identity inference.'})
        with store.connect() as db:
            bundled = _bundled_event(db, snapshot, site)
        if not bundled:
            engine.observations([obs.model_dump(mode='json')])
        # Bundled plans are immutable TwinForge export artifacts, not registered
        # engine revisions. Persist their signed, unknown-location observation
        # with the incident; do not invent an engine revision or spatial result.
        title = (classification.display_label if classification else
                 ('Ring doorbell pressed' if row['kind']=='button_press' else 'Ring motion reported'))
        rule = ('Luna classified up to three chronological event snapshots; the result is an AI interpretation that requires review. '
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
                    db, incident.site_id, incident.revision_id, obs, row['account']
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
                    if inserted:
                        db.execute('INSERT INTO live_incident_accounts VALUES (?,?)',
                                   (incident.id, digest(row['account'])))
                        event(db, incident.site_id, 'incident.created', incident.id)
            db.execute("UPDATE ring_inbox SET state='succeeded',processed=?,error=NULL WHERE id=?", (now(), row['id']))
            service._metric(db, row['account'], 'incident_ready_ms', max(
                0, (datetime.now().astimezone() - datetime.fromisoformat(row['received'])).total_seconds() * 1000
            ))
    except Exception as error:
        # Diagnose the failing stage without logging provider bodies or secrets.
        status = getattr(error, 'code', None)
        log.warning('Ring event processing failed: type=%s http_status=%s',
                    type(error).__name__, status if isinstance(status, int) else None)
        with store.connect() as db:
            final = row['attempts'] >= 2
            db.execute('UPDATE ring_inbox SET state=?,lease=?,processed=?,error=? WHERE id=?',
                       ('failed' if final else 'running', time.time()+5, now() if final else None,
                        'Processing failed; retry is bounded' if final else 'Retry scheduled', row['id']))
            service._metric(db, row['account'], 'processing_errors', count=1)
            service._metric(db, row['account'], 'dead_letters' if final else 'retries_scheduled', count=1)
    return True
