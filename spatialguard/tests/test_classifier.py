import io
import json
import urllib.error

import pytest

from spatialguard_api import classifier


class Response:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return io.BytesIO(json.dumps(self.value).encode())

    def __exit__(self, *args):
        return False


def completed(label="delivery_activity"):
    proposal = {
        "label": label,
        "confidence": "medium",
        "summary": "A person appears to be placing a parcel near the entrance.",
        "visible_evidence": ["Parcel-shaped object", "Person near the doorway"],
        "uncertainty": "Uniform and delivery markings are not readable.",
    }
    return {
        "id": "resp_test",
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(proposal)}]}],
    }


def configure(monkeypatch):
    monkeypatch.setattr(classifier, "_load_environment", lambda: None)
    monkeypatch.setenv("OPENAI_API_KEY", "server-secret")
    monkeypatch.setenv("SPATIALGUARD_CLASSIFIER_MODEL", "gpt-5.6-luna")


def test_luna_request_uses_structured_snapshot_classification(monkeypatch):
    configure(monkeypatch)
    captured = {}

    def open_request(request, timeout):
        captured["payload"] = json.loads(request.data)
        captured["timeout"] = timeout
        return Response(completed())

    monkeypatch.setattr(classifier.urllib.request, "urlopen", open_request)
    result = classifier.classify_image(b"jpeg-bytes", "image/jpeg")
    payload = captured["payload"]
    assert payload["model"] == "gpt-5.6-luna"
    assert payload["store"] is False
    assert payload["text"]["format"]["type"] == "json_schema"
    assert payload["input"][0]["content"][1]["image_url"].startswith("data:image/jpeg;base64,")
    assert result.label == "delivery_activity"
    assert result.display_label == "Possible delivery"
    assert result.response_id == "resp_test"


def test_provider_errors_never_expose_response_body(monkeypatch):
    configure(monkeypatch)

    def denied(*args, **kwargs):
        raise urllib.error.HTTPError(
            "https://api.openai.com/v1/responses",
            401,
            "denied",
            {},
            io.BytesIO(b"server-secret must never be returned"),
        )

    monkeypatch.setattr(classifier.urllib.request, "urlopen", denied)
    with pytest.raises(classifier.ClassifierUnavailable) as error:
        classifier.classify_image(b"jpeg-bytes", "image/jpeg")
    assert "server-secret" not in str(error.value)
    assert "rejected" in str(error.value)


def test_sequence_preserves_frame_order_and_uses_one_request(monkeypatch):
    configure(monkeypatch)
    captured = []

    def open_request(request, timeout):
        captured.append(json.loads(request.data))
        return Response(completed())

    monkeypatch.setattr(classifier.urllib.request, "urlopen", open_request)
    result = classifier.classify_images([b"first", b"second"], "image/jpeg")
    assert result.label == "delivery_activity"
    assert len(captured) == 1
    content = captured[0]["input"][0]["content"]
    assert "chronological order" in content[0]["text"]
    import base64
    assert [base64.b64decode(item["image_url"].split(",")[1]) for item in content[1:]] == [b"first", b"second"]


def test_sequence_rejects_unbounded_or_empty_input(monkeypatch):
    configure(monkeypatch)
    for images in ([], [b"x"] * 7, [b"valid", b""]):
        with pytest.raises(classifier.ClassifierUnavailable):
            classifier.classify_images(images, "image/jpeg")
