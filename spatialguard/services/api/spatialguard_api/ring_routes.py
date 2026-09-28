from fastapi import Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import Field
from typing import Literal
from .models import ClassifierStatus, Incident, Model, PairCode, TestVideoTrack
from .incident_tracking import IncidentTracker
from .ring_service import RingService
from .classifier import ClassifierUnavailable, classify_images, status as classifier_status
from .store import account_preferences, audit, access_log, event
from .release import capabilities, require_feature


class RingSubscription(Model):
    required: bool
    eligible: bool
    state: Literal['active_paid', 'active_trial', 'not_active']
    expires_at: str | None = None
    manage_url: str


class RingStatus(Model):
    configured: bool
    state: str
    public_url: str | None
    subscription: RingSubscription | None = None
    subscription_checked_at: str | None = None


class RingMapping(Model):
    site_id: str
    camera_id: str


class RingDevice(Model):
    id: str
    name: str
    status: dict
    capabilities: dict
    checked_at: str
    site_id: str | None
    camera_id: str | None
    hardware_model: Literal['video_doorbell', 'stick_up_cam'] | None = None
    support: dict[str, bool] = Field(default_factory=dict)
    configuration: dict = Field(default_factory=dict)
    guidance: list[str] = Field(default_factory=list)


class StreamOffer(Model):
    sdp: str = Field(min_length=10, max_length=100000)


class StreamAnswer(Model):
    id: str
    sdp: str
    expires_at: float


class StreamState(Model):
    state: str
    expires_at: float


class OperationsPreferences(Model):
    delay_seconds: int = Field(default=0, ge=0, le=3600)
    browser_enabled: bool = False
    email_enabled: bool = False
    email: str = Field(default='', max_length=254)


class CameraWall(Model):
    devices: list[str] = Field(max_length=16)


class TimelapseInput(Model):
    device: str
    site: str
    camera: str
    name: str = Field(min_length=1, max_length=80)
    cadence_minutes: int = Field(ge=5, le=1440)
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=0, le=23)
    timezone: str = Field(default='America/Phoenix', min_length=1, max_length=80)


def install(app, store, principal, service=None):
    tracker = IncidentTracker()
    ring = service or RingService(store)
    app.state.ring = ring

    def require_ring_consent(owner):
        with store.connect() as db:
            preferences = account_preferences(db, owner)
        if not preferences['ring_data_consent']:
            raise HTTPException(409, 'Allow Ring data in Privacy settings first')
        return preferences

    def require_classification_consent(owner):
        preferences = require_ring_consent(owner)
        if not preferences['classification_consent']:
            raise HTTPException(409, 'Allow snapshot classification in Privacy settings first')

    @app.get('/v1/ring', response_model=RingStatus)
    def status(p=Depends(principal)):
        return ring.status(p['owner'])

    @app.get('/v1/classifier', response_model=ClassifierStatus)
    def classification_status(p=Depends(principal)):
        if not capabilities()['classification']:
            return {'configured': False, 'model': 'Disabled for this release'}
        return classifier_status()

    @app.post('/v1/ring/sign-in-code', response_model=PairCode)
    def code(p=Depends(principal)):
        require_ring_consent(p['owner'])
        return ring.code(p['owner'])

    @app.get('/v1/ring/devices', response_model=list[RingDevice])
    def devices(p=Depends(principal)):
        require_ring_consent(p['owner'])
        return ring.devices(p['owner'])

    @app.post('/v1/ring/devices/refresh', response_model=list[RingDevice])
    def refresh(p=Depends(principal)):
        require_ring_consent(p['owner'])
        return ring.devices(p['owner'], True)

    @app.get('/v1/ring/operations')
    def operations(p=Depends(principal)):
        require_ring_consent(p['owner'])
        result = ring.operations(p['owner'])
        flags = capabilities()
        if not flags['uptime_history']:
            for device in result.get('devices', []):
                device['history'] = []
        if not flags['offline_alerts']:
            result['alerts'] = []
        if not flags['timelapse']:
            result['timelapses'] = []
        return result

    @app.patch('/v1/ring/operations/preferences', status_code=204)
    def operations_preferences(body: OperationsPreferences, p=Depends(principal)):
        require_ring_consent(p['owner'])
        require_feature('offline_alerts')
        ring.update_operations_preferences(p['owner'], body.model_dump())

    @app.put('/v1/ring/operations/wall', status_code=204)
    def camera_wall(body: CameraWall, p=Depends(principal)):
        require_ring_consent(p['owner'])
        ring.save_camera_wall(p['owner'], body.devices)

    @app.post('/v1/ring/operations/alerts/{alert_id}/acknowledge', status_code=204)
    def acknowledge_alert(alert_id: str, p=Depends(principal)):
        require_ring_consent(p['owner'])
        require_feature('offline_alerts')
        ring.acknowledge_alert(p['owner'], alert_id)

    @app.post('/v1/ring/timelapses', status_code=201)
    def create_timelapse(body: TimelapseInput, p=Depends(principal)):
        require_ring_consent(p['owner'])
        require_feature('timelapse')
        return {'id': ring.create_timelapse(p['owner'], body.model_dump())}

    @app.post('/v1/ring/timelapses/{project_id}/capture', status_code=201)
    def capture_timelapse(project_id: str, p=Depends(principal)):
        require_ring_consent(p['owner'])
        require_feature('timelapse')
        return {'id': ring.capture_timelapse(p['owner'], project_id)}

    @app.get('/v1/ring/timelapses/{project_id}/frames/{frame_id}', response_class=Response)
    def timelapse_frame(project_id: str, frame_id: str, p=Depends(principal)):
        require_ring_consent(p['owner'])
        require_feature('timelapse')
        content, media_type = ring.timelapse_frame(p['owner'], project_id, frame_id)
        return Response(content, media_type=media_type, headers={'Cache-Control':'private, max-age=300'})

    @app.get('/v1/ring/timelapses/{project_id}/reel', response_class=Response)
    def timelapse_reel(project_id: str, p=Depends(principal)):
        require_ring_consent(p['owner'])
        require_feature('timelapse')
        return Response(ring.timelapse_reel(p['owner'], project_id), media_type='image/gif',
                        headers={'Content-Disposition':f'attachment; filename="spatialguard-{project_id}.gif"'})

    @app.delete('/v1/ring/timelapses/{project_id}', status_code=204)
    def delete_timelapse(project_id: str, p=Depends(principal)):
        require_ring_consent(p['owner'])
        require_feature('timelapse')
        ring.delete_timelapse(p['owner'], project_id)

    @app.put('/v1/ring/devices/{device}/mapping', status_code=204)
    def mapping(device: str, body: RingMapping, p=Depends(principal)):
        require_ring_consent(p['owner'])
        ring.mapping(p['owner'], device, body.site_id, body.camera_id)

    @app.get(
        '/v1/ring/sites/{site}/cameras/{camera}/snapshot',
        response_class=Response,
        responses={200: {'content': {'image/jpeg': {}, 'image/png': {}}}},
    )
    def snapshot(site: str, camera: str, p=Depends(principal)):
        require_ring_consent(p['owner'])
        image, content_type, metadata = ring.snapshot(p['owner'], site, camera)
        with store.connect() as db:
            access_log(db, p['owner'], p.get('name', 'Signed-in session'), 'snapshot.viewed',
                       'Mapped Ring camera', 'Show the latest authorized camera image')
        headers = {'Cache-Control': 'private, max-age=30'}
        headers.update(metadata)
        return Response(content=image, media_type=content_type, headers=headers)

    @app.get('/v1/incidents/{incident_id}/observations/{observation_id}/clip',
             response_class=Response, responses={200: {'content': {'video/mp4': {}}}})
    def incident_clip(incident_id: str, observation_id: str, p=Depends(principal)):
        require_ring_consent(p['owner'])
        media, metadata = ring.incident_clip(p['owner'], incident_id, observation_id)
        with store.connect() as db:
            access_log(db, p['owner'], p.get('name', 'Signed-in session'), 'recording.viewed',
                       'Authorized Ring camera', 'Owner requested incident recording')
        return Response(content=media, media_type='video/mp4', headers={
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', **metadata,
        })

    @app.get('/v1/incidents/{incident_id}/observations/{observation_id}/track', response_model=TestVideoTrack)
    def incident_track(incident_id: str, observation_id: str, response: Response,
                       clip_digest: str = Query(pattern=r'^[0-9a-f]{64}$'), p=Depends(principal)):
        require_feature('classification')
        require_ring_consent(p['owner'])
        response.headers['Cache-Control'] = 'private, no-store'
        result = tracker.analyze(ring, p['owner'], incident_id, observation_id, clip_digest)
        if result.points:
            # Keep only where the person first appeared, to place this event on
            # the people heatmap; the track itself is not stored.
            first = result.points[0]
            with store.connect() as db:
                row = db.execute('SELECT site_id FROM incidents WHERE id=?', (incident_id,)).fetchone()
                if row:
                    db.execute(
                        'INSERT OR REPLACE INTO observation_footpoints VALUES (?,?,?,?,?,?)',
                        (incident_id, observation_id, row['site_id'], first.foot_x_norm, first.foot_y_norm, first.confidence),
                    )
        return result

    @app.post('/v1/incidents/{incident_id}/classify', response_model=Incident)
    def classify_incident(incident_id: str, p=Depends(principal)):
        require_feature('classification')
        require_classification_consent(p['owner'])
        with store.connect() as db:
            row = db.execute(
                'SELECT i.data FROM incidents i JOIN sites s ON s.id=i.site_id '
                'WHERE i.id=? AND s.owner=?',
                (incident_id, p['owner']),
            ).fetchone()
        if not row:
            raise HTTPException(404, 'Incident not found')
        incident = Incident.model_validate_json(row['data'])
        if incident.evidence_mode != 'live' or not incident.observations:
            raise HTTPException(409, 'Only live Ring incidents can classify a camera snapshot')
        camera = incident.observations[0].source_id
        images, content_type = ring.event_snapshots(
            p['owner'], incident.site_id, camera,
            incident.observations[0].observed_at.isoformat(),
        )
        try:
            classification = classify_images(images, content_type)
        except ClassifierUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        updated = incident.model_copy(update={
            'title': classification.display_label,
            'rule': ('Luna classified up to three chronological event snapshots; the result is an AI interpretation '
                     'that requires review. Position and identity remain unknown.'),
            'classification_status': 'completed',
            'classification': classification,
        })
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            owned = db.execute(
                'SELECT 1 FROM sites WHERE id=? AND owner=?',
                (incident.site_id, p['owner']),
            ).fetchone()
            if not owned:
                raise HTTPException(404, 'Incident not found')
            db.execute('UPDATE incidents SET data=? WHERE id=?',
                       (updated.model_dump_json(), incident_id))
            event(db, incident.site_id, 'incident.classified', incident_id)
            audit(db, p['owner'], 'incident.classified', incident_id)
            access_log(db, p['owner'], p.get('name', 'Signed-in session'), 'snapshot.classified',
                       'Mapped Ring camera', 'Explain an owner-selected incident')
        return updated

    @app.post('/v1/ring/devices/{device}/streams', response_model=StreamAnswer)
    def stream(device: str, body: StreamOffer, p=Depends(principal)):
        require_ring_consent(p['owner'])
        answer = ring.stream(p['owner'], device, body.sdp)
        with store.connect() as db:
            access_log(db, p['owner'], p.get('name', 'Signed-in session'), 'live_view.opened',
                       'Authorized Ring camera', 'Owner requested a live view')
        return answer

    @app.delete('/v1/ring/streams/{sid}', status_code=204)
    def close(sid: str, p=Depends(principal)):
        ring.close_stream(p['owner'], sid)
        with store.connect() as db:
            access_log(db, p['owner'], p.get('name', 'Signed-in session'), 'live_view.closed',
                       'Authorized Ring camera', 'Owner ended a live view')

    @app.get('/v1/ring/event-deliveries')
    def event_deliveries(p=Depends(principal)):
        """Sanitized provider processing state; payloads and provider IDs stay hidden."""
        require_ring_consent(p['owner'])
        with store.connect() as db:
            rows = db.execute(
                "SELECT i.kind,i.received,i.state,i.attempts,i.error,i.provider_request FROM ring_inbox i "
                "JOIN ring_accounts a ON a.account=i.account WHERE a.owner=? "
                "ORDER BY i.rowid DESC LIMIT 100", (p['owner'],),
            ).fetchall()
        return [{
            'event_type': row['kind'], 'request_id': (row['provider_request'] or '')[:12], 'received_at': row['received'],
            'state': row['state'], 'attempts': row['attempts'],
            'failure': 'Provider event could not be processed' if row['error'] else None,
        } for row in rows]

    @app.get('/v1/ring/pipeline-metrics')
    def pipeline_metrics(p=Depends(principal)):
        require_ring_consent(p['owner'])
        from datetime import datetime, timezone
        import time
        account = ring.account(p['owner'])['account']
        with store.connect() as db:
            rows = db.execute(
                "SELECT i.received,i.processed,i.state,i.attempts FROM ring_inbox i "
                "JOIN ring_accounts a ON a.account=i.account WHERE a.owner=? ORDER BY i.rowid DESC LIMIT 500",
                (p['owner'],),
            ).fetchall()
            telemetry = {row['name']: dict(row) for row in db.execute(
                'SELECT name,count,total,maximum,updated FROM ring_telemetry WHERE account=?',
                (account,),
            )}
            health = db.execute(
                'SELECT device,at,online FROM ring_health WHERE account=? ORDER BY device,at',
                (account,),
            ).fetchall()
            leaked = db.execute(
                "SELECT count(*) FROM ring_streams WHERE account=? AND state IN ('opening','active','closing') AND expires<?",
                (account, time.time()),
            ).fetchone()[0]
        durations = []
        for row in rows:
            if row['processed']:
                durations.append(max(0, (datetime.fromisoformat(row['processed']) - datetime.fromisoformat(row['received'])).total_seconds() * 1000))
        def aggregate(name):
            value = telemetry.get(name)
            return {
                'sample_size': value['count'] if value else 0,
                'average': round(value['total']/value['count'], 1) if value and value['count'] else None,
                'maximum': round(value['maximum'], 1) if value else None,
            }
        offline = {}
        recoveries = []
        for item in health:
            if not item['online']:
                offline[item['device']] = item['at']
            elif item['device'] in offline:
                recoveries.append(max(0, item['at']-offline.pop(item['device'])))
        pending = [row for row in rows if row['state'] in {'queued','running'}]
        oldest_queue_age = None
        if pending:
            oldest = min(datetime.fromisoformat(row['received']) for row in pending)
            oldest_queue_age = round(max(0, (datetime.now(timezone.utc)-oldest).total_seconds()), 1)
        failures = sum(row['state'] == 'failed' for row in rows)
        return {
            'sample_size': len(rows),
            'processed': sum(row['state'] in {'succeeded','ignored'} for row in rows),
            'failed': failures,
            'retrying': sum(row['state'] == 'running' and row['attempts'] > 0 for row in rows),
            'error_rate_percent': round(failures/len(rows)*100, 2) if rows else 0,
            'duplicates_suppressed': int(telemetry.get('duplicates_suppressed', {}).get('count', 0)),
            'dead_letters': int(telemetry.get('dead_letters', {}).get('count', 0)),
            'oldest_queue_age_seconds': oldest_queue_age,
            'provider_session_leaks': leaked,
            'webhook_ack_latency_ms': aggregate('webhook_ack_ms'),
            'queue_latency_ms': aggregate('queue_latency_ms'),
            'incident_creation_latency_ms': aggregate('incident_ready_ms'),
            'processing_latency_ms': {
                'average': round(sum(durations) / len(durations), 1) if durations else None,
                'maximum': round(max(durations), 1) if durations else None,
            },
            'recovery_time_seconds': {
                'sample_size': len(recoveries),
                'average': round(sum(recoveries)/len(recoveries), 1) if recoveries else None,
                'maximum': round(max(recoveries), 1) if recoveries else None,
            },
        }

    @app.get('/v1/ring/streams/{sid}', response_model=StreamState)
    def stream_state(sid: str, p=Depends(principal)):
        import time
        with store.connect() as db:
            row = db.execute('SELECT * FROM ring_streams WHERE id=? AND owner=?', (sid,p['owner'])).fetchone()
            if not row: raise HTTPException(404, 'Stream not found')
            return {'state':row['state'] if row['expires']>time.time() else 'expired','expires_at':row['expires']}

    @app.delete('/v1/ring', status_code=204)
    def disconnect(p=Depends(principal)):
        ring.disconnect(p['owner'])
