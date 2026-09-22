"""Local, owner-only replay of private Ring clips for detector evaluation."""
from pathlib import Path
import json
import os

import cv2
from fastapi import Depends, HTTPException, Request
from fastapi.responses import FileResponse

from .classifier import ClassifierUnavailable, classify_images
from .models import IncidentClassification, TestVideo, TestVideoTrack
from .person_tracking import MODEL, PersonDetectorUnavailable, track_video
from .store import DATA
from .release import require_feature


VIDEO_ROOT = DATA / "test-ring-video"
CATALOG = {
    "delivery-day": TestVideo(
        id="delivery-day",
        name="Delivery test · daylight",
        lighting="day",
        duration_seconds=21.61,
        classification_frame_seconds=1.0,
    ),
    "delivery-night": TestVideo(
        id="delivery-night",
        name="Delivery test · night",
        lighting="night",
        duration_seconds=15.51,
        classification_frame_seconds=0.7,
    ),
}


def path_for(video_id: str) -> Path:
    if video_id not in CATALOG:
        raise HTTPException(404, "Test video not found")
    path = VIDEO_ROOT / f"{video_id}.mp4"
    if not path.is_file():
        raise HTTPException(404, "Test video is unavailable")
    return path


def frame_for(video_id: str, at_seconds: float | None = None) -> bytes:
    video = CATALOG.get(video_id)
    path = path_for(video_id)
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ClassifierUnavailable("The test video frame could not be decoded.")
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, 1000 * (video.classification_frame_seconds if at_seconds is None else at_seconds))
        ok, frame = capture.read()
    finally:
        capture.release()
    if not ok:
        raise ClassifierUnavailable("The test video did not contain a readable frame.")
    encoded, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not encoded:
        raise ClassifierUnavailable("The test video frame could not be encoded.")
    return jpeg.tobytes()


def classification_frames(video_id: str) -> list[bytes]:
    """Sample the detected activity interval, not just one glare-obscured first frame."""
    video = CATALOG.get(video_id)
    path_for(video_id)
    try:
        points = person_track_for(video_id).points
    except PersonDetectorUnavailable:
        points = []
    start = points[0].t_seconds if points else 0
    end = points[-1].t_seconds if points else video.duration_seconds - .2
    # Six chronological views, including the near-door activity and departure.
    times = [start + (end - start) * ratio for ratio in (0, .15, .3, .5, .7, .95)]
    return [frame_for(video_id, round(at, 2)) for at in times]


def person_track_for(video_id: str) -> TestVideoTrack:
    path = path_for(video_id)
    cache = VIDEO_ROOT / f"{video_id}.track.json"
    source_mtime = path.stat().st_mtime_ns
    model_mtime = MODEL.stat().st_mtime_ns if MODEL.is_file() else 0
    if cache.is_file():
        try:
            saved = json.loads(cache.read_text(encoding="utf-8"))
            if saved.get("source_mtime") == source_mtime and saved.get("model_mtime") == model_mtime:
                return TestVideoTrack.model_validate(saved["track"])
        except (OSError, ValueError, KeyError):
            pass
    result = track_video(video_id, path)
    temporary = cache.with_suffix(".tmp")
    temporary.write_text(json.dumps({
        "source_mtime": source_mtime,
        "model_mtime": model_mtime,
        "track": result.model_dump(mode="json"),
    }), encoding="utf-8")
    temporary.replace(cache)
    return result


def install(app, principal):
    def fixture_owner(p):
        if p["owner"] not in {"local_owner", "acct_test_preview"}:
            raise HTTPException(404, "Test videos are unavailable")

    @app.get("/v1/test-videos", response_model=list[TestVideo])
    def test_videos(p=Depends(principal)):
        require_feature("test_video")
        fixture_owner(p)
        return [video for key, video in CATALOG.items() if (VIDEO_ROOT / f"{key}.mp4").is_file()]

    @app.get("/v1/test-videos/{video_id}/media", response_class=FileResponse)
    def test_video_media(video_id: str, p=Depends(principal)):
        require_feature("test_video")
        fixture_owner(p)
        return FileResponse(
            path_for(video_id),
            media_type="video/mp4",
            filename=f"{video_id}.mp4",
            content_disposition_type="inline",
            headers={"Cache-Control": "private, no-store"},
        )

    @app.get("/v1/test-videos/{video_id}/track", response_model=TestVideoTrack)
    def test_video_track(video_id: str, p=Depends(principal)):
        require_feature("test_video")
        fixture_owner(p)
        try:
            return person_track_for(video_id)
        except PersonDetectorUnavailable as exc:
            raise HTTPException(503, str(exc)) from None

    @app.post(
        "/v1/test-videos/{video_id}/classify",
        response_model=IncidentClassification,
    )
    def classify_test_video(video_id: str, p=Depends(principal)):
        require_feature("test_video")
        require_feature("classification")
        fixture_owner(p)
        try:
            return classify_images(classification_frames(video_id), "image/jpeg")
        except ClassifierUnavailable as exc:
            raise HTTPException(503, str(exc)) from None

    @app.put("/v1/test-videos/{video_id}/media", response_model=TestVideo, include_in_schema=False)
    async def provision_test_video(video_id: str, request: Request, p=Depends(principal)):
        """One-time private fixture provisioning for the isolated reviewer account."""
        require_feature("test_video")
        fixture_owner(p)
        if p["owner"] != "acct_test_preview":
            raise HTTPException(403, "Reviewer fixture account required")
        video = CATALOG.get(video_id)
        if not video:
            raise HTTPException(404, "Test video not found")
        target = VIDEO_ROOT / f"{video_id}.mp4"
        if target.exists():
            raise HTTPException(409, "Test video is already provisioned")
        declared = int(request.headers.get("content-length", "0") or 0)
        if declared <= 0 or declared > 12_000_000:
            raise HTTPException(413, "Test video must be between 1 byte and 12 MB")
        body = await request.body()
        if not body or len(body) > 12_000_000:
            raise HTTPException(413, "Test video must be between 1 byte and 12 MB")
        VIDEO_ROOT.mkdir(parents=True, exist_ok=True)
        temporary = VIDEO_ROOT / f".{video_id}.{os.getpid()}.upload.mp4"
        try:
            temporary.write_bytes(body)
            capture = cv2.VideoCapture(str(temporary))
            try:
                valid = capture.isOpened() and capture.get(cv2.CAP_PROP_FRAME_COUNT) > 1
            finally:
                capture.release()
            if not valid:
                raise HTTPException(422, "Uploaded test video could not be decoded")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return video

    @app.put("/v1/test-videos/{video_id}/track", response_model=TestVideoTrack, include_in_schema=False)
    def provision_test_track(video_id: str, body: TestVideoTrack, p=Depends(principal)):
        require_feature("test_video")
        fixture_owner(p)
        if p["owner"] != "acct_test_preview":
            raise HTTPException(403, "Reviewer fixture account required")
        path = path_for(video_id)
        if body.video_id != video_id or not body.points:
            raise HTTPException(422, "Track must match the test video and contain points")
        cache = VIDEO_ROOT / f"{video_id}.track.json"
        if cache.exists():
            raise HTTPException(409, "Test track is already provisioned")
        cache.write_text(json.dumps({
            "source_mtime": path.stat().st_mtime_ns,
            "model_mtime": MODEL.stat().st_mtime_ns if MODEL.is_file() else 0,
            "track": body.model_dump(mode="json"),
        }), encoding="utf-8")
        return body
