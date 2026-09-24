import hashlib

import pytest
from fastapi import HTTPException

from spatialguard_api import incident_tracking as module
from spatialguard_api.models import TestVideoTrack as VideoTrack
from spatialguard_api.person_tracking import PersonDetectorUnavailable


class Ring:
    allowed = True
    media = b'recorded-clip'
    def authorize_incident_recording(self, owner, incident, observation):
        if not self.allowed or (owner, incident, observation) != ('owner', 'incident', 'observation'):
            raise HTTPException(404, 'Unavailable')
    def incident_clip(self, owner, incident, observation):
        self.authorize_incident_recording(owner, incident, observation)
        return self.media, {}


def test_exact_clip_cleanup_cached_authorization_and_revocation(tmp_path, monkeypatch):
    monkeypatch.setattr(module, 'DATA', tmp_path)
    ring = Ring()
    calls = []
    def detect(identity, path):
        calls.append(path)
        assert path.read_bytes() == ring.media
        return VideoTrack(video_id=identity, detector='test', points=[])
    monkeypatch.setattr(module, 'track_video', detect)
    tracker = module.IncidentTracker()
    digest = hashlib.sha256(ring.media).hexdigest()
    for _ in range(2):
        assert tracker.analyze(ring, 'owner', 'incident', 'observation', digest).points == []
    assert len(calls) == 1 and not calls[0].exists()
    for args in [('other', 'incident', 'observation'), ('owner', 'incident', 'other')]:
        with pytest.raises(HTTPException): tracker.analyze(ring, *args, digest)
    ring.allowed = False
    with pytest.raises(HTTPException): tracker.analyze(ring, 'owner', 'incident', 'observation', digest)


def test_mismatched_clip_never_analyzed(tmp_path, monkeypatch):
    monkeypatch.setattr(module, 'DATA', tmp_path)
    monkeypatch.setattr(module, 'track_video', lambda *args: pytest.fail('must not analyze a different clip'))
    with pytest.raises(HTTPException) as error:
        module.IncidentTracker().analyze(Ring(), 'owner', 'incident', 'observation', 'a'*64)
    assert error.value.status_code == 409


@pytest.mark.parametrize('revoke', [False, True])
def test_analysis_failure_removes_scratch_and_releases_slot(tmp_path, monkeypatch, revoke):
    monkeypatch.setattr(module, 'DATA', tmp_path)
    ring = Ring()
    paths = []
    def detect(identity, path):
        paths.append(path)
        if revoke:
            ring.allowed = False
            return VideoTrack(video_id=identity, detector='test', points=[])
        raise PersonDetectorUnavailable('Detector unavailable')
    monkeypatch.setattr(module, 'track_video', detect)
    tracker = module.IncidentTracker()
    with pytest.raises(HTTPException) as error:
        tracker.analyze(ring, 'owner', 'incident', 'observation', hashlib.sha256(ring.media).hexdigest())
    assert error.value.status_code == (404 if revoke else 503)
    assert not paths[0].exists() and not tracker._lock.locked() and not tracker._tracks


def test_busy_analysis_is_retryable():
    tracker = module.IncidentTracker()
    tracker._lock.acquire()
    try:
        with pytest.raises(HTTPException) as error:
            tracker.analyze(Ring(), 'owner', 'incident', 'observation', 'a'*64)
        assert error.value.status_code == 429
    finally:
        tracker._lock.release()
