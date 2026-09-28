"""Bounded analysis of an authorized recording; original observations stay immutable."""
import hashlib
import tempfile
import threading
import time
from pathlib import Path

from fastapi import HTTPException

from .person_tracking import MODEL, PersonDetectorUnavailable, track_video
from .store import DATA


class IncidentTracker:
    def __init__(self):
        self._lock = threading.Lock()
        self._tracks = {}

    def analyze(self, ring, owner, incident, observation, clip_digest=None):
        # Always reauthorize, even a cached result, after unlink/remap/deletion.
        ring.authorize_incident_recording(owner, incident, observation)
        if not self._lock.acquire(blocking=False):
            raise HTTPException(429, 'Another recording is being analyzed. Retry movement shortly.')
        try:
            key = (owner, incident, observation, clip_digest,
                   MODEL.stat().st_mtime_ns if MODEL.is_file() else 0)
            self._tracks = {k: v for k, v in self._tracks.items() if v[0] > time.monotonic()}
            cached = self._tracks.get(key)
            if cached:
                return cached[1]
            media, _ = ring.incident_clip(owner, incident, observation)
            # Without a digest, the analyzed clip is the one this server serves for playback.
            if clip_digest is not None and hashlib.sha256(media).hexdigest() != clip_digest:
                raise HTTPException(409, 'The recording changed. Reload the recording to synchronize movement.')
            directory = DATA / 'transient-recordings'
            directory.mkdir(parents=True, exist_ok=True)
            # OpenCV requires a seekable file; private scratch is deleted on success/error.
            with tempfile.TemporaryDirectory(dir=directory) as temporary:
                path = Path(temporary) / 'clip.mp4'
                path.write_bytes(media)
                result = track_video(observation, path)
            ring.authorize_incident_recording(owner, incident, observation)
            if len(self._tracks) >= 16:
                self._tracks.pop(next(iter(self._tracks)))
            self._tracks[key] = (time.monotonic() + 600, result)
            return result
        except PersonDetectorUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        finally:
            self._lock.release()
