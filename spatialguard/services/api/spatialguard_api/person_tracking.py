"""Person-only tracks for private test clips using OpenCV 5 and YOLO11 ONNX."""
from collections import deque
from pathlib import Path

import cv2
import numpy as np

from .models import TestTrackPoint, TestVideoTrack
from .store import DATA


MODEL = DATA / "models" / "yolo11n.onnx"
SIZE = 640


class PersonDetectorUnavailable(RuntimeError):
    pass


def _letterbox(frame):
    height, width = frame.shape[:2]
    scale = min(SIZE / width, SIZE / height)
    resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
    canvas = np.full((SIZE, SIZE, 3), 114, dtype=np.uint8)
    left = (SIZE - resized.shape[1]) // 2
    top = (SIZE - resized.shape[0]) // 2
    canvas[top : top + resized.shape[0], left : left + resized.shape[1]] = resized
    return canvas, scale, left, top


def _iou(a, b):
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, right - left) * max(0, bottom - top)
    union = max(1, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection)
    return intersection / union


def _person_boxes(net, frame):
    image, scale, pad_x, pad_y = _letterbox(frame)
    blob = cv2.dnn.blobFromImage(image, 1 / 255.0, (SIZE, SIZE), swapRB=True, crop=False)
    net.setInput(blob)
    output = net.forward()
    rows = output[0].T if output.shape[1] < output.shape[2] else output[0]
    boxes, scores = [], []
    for row in rows:
        confidence = float(row[4])  # COCO class 0: person
        if confidence < 0.24:
            continue
        cx, cy, width, height = map(float, row[:4])
        left = (cx - width / 2 - pad_x) / scale
        top = (cy - height / 2 - pad_y) / scale
        right = (cx + width / 2 - pad_x) / scale
        bottom = (cy + height / 2 - pad_y) / scale
        boxes.append([left, top, right - left, bottom - top])
        scores.append(confidence)
    keep = cv2.dnn.NMSBoxes(boxes, scores, 0.24, 0.45)
    result = []
    for index in np.array(keep).reshape(-1) if len(keep) else []:
        left, top, width, height = boxes[int(index)]
        result.append((left, top, left + width, top + height, scores[int(index)]))
    return result


def _smooth(raw):
    if not raw:
        return []
    # Fill short detector dropouts, then median-filter the foot point before EMA.
    expanded = []
    for index, point in enumerate(raw):
        if index:
            previous = raw[index - 1]
            gap = point[0] - previous[0]
            if 0.38 < gap <= 1.25:
                steps = round(gap / 0.2)
                for step in range(1, steps):
                    ratio = step / steps
                    expanded.append(tuple(previous[j] + (point[j] - previous[j]) * ratio for j in range(4)))
        expanded.append(point)
    window = deque(maxlen=5)
    result, filtered = [], None
    for at, x, y, confidence in expanded:
        window.append((x, y))
        median_x = float(np.median([item[0] for item in window]))
        median_y = float(np.median([item[1] for item in window]))
        if filtered is None:
            filtered = [median_x, median_y]
        else:
            filtered[0] += 0.28 * (median_x - filtered[0])
            filtered[1] += 0.22 * (median_y - filtered[1])
        result.append(TestTrackPoint(
            t_seconds=round(at, 3),
            foot_x_norm=max(0, min(1, filtered[0])),
            foot_y_norm=max(0, min(1, filtered[1])),
            confidence=max(0, min(1, confidence)),
        ))
    return result


def track_video(video_id: str, path: Path) -> TestVideoTrack:
    if not MODEL.is_file():
        raise PersonDetectorUnavailable("The local person-detection model is unavailable.")
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise PersonDetectorUnavailable("The private test video could not be opened.")
    try:
        fps = capture.get(cv2.CAP_PROP_FPS) or 20
        stride = max(1, round(fps / 5))
        net = cv2.dnn.readNetFromONNX(str(MODEL))
        raw, frame_index, previous_box = [], 0, None
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % stride:
                frame_index += 1
                continue
            boxes = _person_boxes(net, frame)
            if boxes:
                if previous_box is None:
                    chosen = max(boxes, key=lambda box: box[4])
                else:
                    chosen = max(boxes, key=lambda box: _iou(box, previous_box) * 2 + box[4])
                previous_box = chosen
                height, width = frame.shape[:2]
                # Ground contact: bottom-center of the person detection, not box height.
                raw.append((
                    frame_index / fps,
                    ((chosen[0] + chosen[2]) / 2) / width,
                    min(height, chosen[3]) / height,
                    chosen[4],
                ))
            frame_index += 1
    finally:
        capture.release()
    return TestVideoTrack(video_id=video_id, detector="OpenCV 5 · YOLO11 person · ground point", points=_smooth(raw))
