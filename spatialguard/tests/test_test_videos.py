from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from spatialguard_api import test_video_routes as videos
from spatialguard_api.models import TestTrackPoint as TrackPointModel
from spatialguard_api.models import TestVideoTrack as VideoTrackModel
from spatialguard_api.person_tracking import _smooth


def test_catalog_paths_are_fixed_and_unknown_ids_are_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(videos, "VIDEO_ROOT", tmp_path)
    (tmp_path / "delivery-day.mp4").write_bytes(b"private-video")
    assert videos.path_for("delivery-day") == tmp_path / "delivery-day.mp4"
    with pytest.raises(HTTPException) as error:
        videos.path_for("../secrets")
    assert error.value.status_code == 404


def test_classifier_frame_is_decoded_to_memory_only(tmp_path, monkeypatch):
    monkeypatch.setattr(videos, "VIDEO_ROOT", tmp_path)
    (tmp_path / "delivery-night.mp4").write_bytes(b"private-video")
    captured = {}

    class Capture:
        def isOpened(self): return True
        def set(self, key, value): captured["seek"] = (key, value)
        def read(self): return True, "decoded-frame"
        def release(self): captured["released"] = True

    monkeypatch.setattr(videos.cv2, "VideoCapture", lambda path: Capture())
    monkeypatch.setattr(videos.cv2, "imencode", lambda suffix, frame, options: (
        True, SimpleNamespace(tobytes=lambda: b"jpeg-frame")
    ))
    assert videos.frame_for("delivery-night") == b"jpeg-frame"
    assert captured["seek"][1] == 700
    assert captured["released"] is True
    assert not list(tmp_path.glob("*.jpg"))


def test_person_track_cache_is_bound_to_private_video_and_model(tmp_path, monkeypatch):
    video_root = tmp_path / "video"
    video_root.mkdir()
    (video_root / "delivery-day.mp4").write_bytes(b"private-video")
    model = tmp_path / "person.onnx"
    model.write_bytes(b"model")
    monkeypatch.setattr(videos, "VIDEO_ROOT", video_root)
    monkeypatch.setattr(videos, "MODEL", model)
    calls = []

    def track(video_id, path):
        calls.append((video_id, path))
        return VideoTrackModel(
            video_id=video_id,
            detector="fixture",
            points=[TrackPointModel(t_seconds=0, foot_x_norm=.5, foot_y_norm=.9, confidence=.8)],
        )

    monkeypatch.setattr(videos, "track_video", track)
    assert videos.person_track_for("delivery-day").points[0].foot_y_norm == .9
    assert videos.person_track_for("delivery-day").detector == "fixture"
    assert len(calls) == 1
    assert (video_root / "delivery-day.track.json").is_file()


def test_ground_point_smoothing_fills_only_short_gaps_and_reduces_jitter():
    raw = [
        (0.0, .40, .80, .8),
        (0.2, .60, .82, .8),
        (0.8, .42, .81, .7),
        (2.4, .90, .40, .9),
    ]
    result = _smooth(raw)
    assert len(result) > len(raw), "the 0.6 second detector gap is interpolated"
    assert result[-1].t_seconds == 2.4, "the 1.6 second gap is not fabricated"
    assert max(point.foot_x_norm for point in result[:-1]) - min(point.foot_x_norm for point in result[:-1]) < .12


def test_classification_samples_activity_in_order_without_clip_name_bias(tmp_path, monkeypatch):
    monkeypatch.setattr(videos, "VIDEO_ROOT", tmp_path)
    (tmp_path / "delivery-night.mp4").write_bytes(b"private-video")
    monkeypatch.setattr(videos, "person_track_for", lambda _: SimpleNamespace(points=[
        SimpleNamespace(t_seconds=2), SimpleNamespace(t_seconds=12),
    ]))
    times = []

    def frame(video_id, at):
        times.append(at)
        return f"frame-{at}".encode()

    monkeypatch.setattr(videos, "frame_for", frame)
    assert len(videos.classification_frames("delivery-night")) == 3
    assert times == [2, 7, 11.5]


def test_classification_deduplicates_identical_test_video_frames(tmp_path, monkeypatch):
    monkeypatch.setattr(videos, "VIDEO_ROOT", tmp_path)
    (tmp_path / "delivery-day.mp4").write_bytes(b"private-video")
    monkeypatch.setattr(videos, "person_track_for", lambda _: SimpleNamespace(points=[]))
    monkeypatch.setattr(videos, "frame_for", lambda *_: b"same-frame")

    assert videos.classification_frames("delivery-day") == [b"same-frame"]
