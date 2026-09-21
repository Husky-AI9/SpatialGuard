from fastapi import Depends, HTTPException
from fastapi.responses import Response
from pydantic import Field
from typing import Literal
from .models import ClassifierStatus, Incident, Model, PairCode
from .ring_service import RingService
from .classifier import ClassifierUnavailable, classify_image, status as classifier_status
from .store import audit, event


class RingStatus(Model):
    configured: bool
    state: str
    public_url: str | None


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
    ring = service or RingService(store)
    app.state.ring = ring

    @app.get('/v1/ring', response_model=RingStatus)
    def status(p=Depends(principal)):
        return ring.status(p['owner'])

    @app.get('/v1/classifier', response_model=ClassifierStatus)
    def classification_status(p=Depends(principal)):
        return classifier_status()

    @app.post('/v1/ring/sign-in-code', response_model=PairCode)
    def code(p=Depends(principal)):
        return ring.code(p['owner'])

    @app.get('/v1/ring/devices', response_model=list[RingDevice])
    def devices(p=Depends(principal)):
        return ring.devices(p['owner'])

    @app.post('/v1/ring/devices/refresh', response_model=list[RingDevice])
    def refresh(p=Depends(principal)):
        return ring.devices(p['owner'], True)

    @app.get('/v1/ring/operations')
    def operations(p=Depends(principal)):
        return ring.operations(p['owner'])

    @app.patch('/v1/ring/operations/preferences', status_code=204)
    def operations_preferences(body: OperationsPreferences, p=Depends(principal)):
        ring.update_operations_preferences(p['owner'], body.model_dump())

    @app.put('/v1/ring/operations/wall', status_code=204)
    def camera_wall(body: CameraWall, p=Depends(principal)):
        ring.save_camera_wall(p['owner'], body.devices)

    @app.post('/v1/ring/operations/alerts/{alert_id}/acknowledge', status_code=204)
    def acknowledge_alert(alert_id: str, p=Depends(principal)):
        ring.acknowledge_alert(p['owner'], alert_id)

    @app.post('/v1/ring/timelapses', status_code=201)
    def create_timelapse(body: TimelapseInput, p=Depends(principal)):
        return {'id': ring.create_timelapse(p['owner'], body.model_dump())}

    @app.post('/v1/ring/timelapses/{project_id}/capture', status_code=201)
    def capture_timelapse(project_id: str, p=Depends(principal)):
        return {'id': ring.capture_timelapse(p['owner'], project_id)}

    @app.get('/v1/ring/timelapses/{project_id}/frames/{frame_id}', response_class=Response)
    def timelapse_frame(project_id: str, frame_id: str, p=Depends(principal)):
        content, media_type = ring.timelapse_frame(p['owner'], project_id, frame_id)
        return Response(content, media_type=media_type, headers={'Cache-Control':'private, max-age=300'})

    @app.get('/v1/ring/timelapses/{project_id}/reel', response_class=Response)
    def timelapse_reel(project_id: str, p=Depends(principal)):
        return Response(ring.timelapse_reel(p['owner'], project_id), media_type='image/gif',
                        headers={'Content-Disposition':f'attachment; filename="spatialguard-{project_id}.gif"'})

    @app.delete('/v1/ring/timelapses/{project_id}', status_code=204)
    def delete_timelapse(project_id: str, p=Depends(principal)):
        ring.delete_timelapse(p['owner'], project_id)

    @app.put('/v1/ring/devices/{device}/mapping', status_code=204)
    def mapping(device: str, body: RingMapping, p=Depends(principal)):
        ring.mapping(p['owner'], device, body.site_id, body.camera_id)

    @app.get(
        '/v1/ring/sites/{site}/cameras/{camera}/snapshot',
        response_class=Response,
        responses={200: {'content': {'image/jpeg': {}, 'image/png': {}}}},
    )
    def snapshot(site: str, camera: str, p=Depends(principal)):
        image, content_type, metadata = ring.snapshot(p['owner'], site, camera)
        headers = {'Cache-Control': 'private, max-age=30'}
        headers.update(metadata)
        return Response(content=image, media_type=content_type, headers=headers)

    @app.post('/v1/incidents/{incident_id}/classify', response_model=Incident)
    def classify_incident(incident_id: str, p=Depends(principal)):
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
        image, content_type, _ = ring.snapshot(p['owner'], incident.site_id, camera)
        try:
            classification = classify_image(image, content_type)
        except ClassifierUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        updated = incident.model_copy(update={
            'title': classification.display_label,
            'rule': ('Luna classified one event snapshot; the result is an AI interpretation '
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
        return updated

    @app.post('/v1/ring/devices/{device}/streams', response_model=StreamAnswer)
    def stream(device: str, body: StreamOffer, p=Depends(principal)):
        return ring.stream(p['owner'], device, body.sdp)

    @app.delete('/v1/ring/streams/{sid}', status_code=204)
    def close(sid: str, p=Depends(principal)):
        ring.close_stream(p['owner'], sid)

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
