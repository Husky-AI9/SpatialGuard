import io
import json
import urllib.error

import pytest
from fastapi import HTTPException
from spatialguard_api.ring_provider import Provider


class Video(io.BytesIO):
    headers = {'Content-Type': 'video/mp4', 'X-Media-Length': '12000'}


def test_clip_follows_signed_redirect_without_forwarding_bearer(monkeypatch):
    calls = []
    class Opener:
        def open(self, request, timeout):
            calls.append(request)
            if len(calls) == 1:
                raise urllib.error.HTTPError(request.full_url, 301, '',
                    {'Location': 'https://download-us.amazonvision.com/video?signed=secret'}, None)
            return Video(b'\x00\x00\x00\x18ftypisomcontent')
    monkeypatch.setattr('urllib.request.build_opener', lambda *args: Opener())
    data, metadata = Provider({'client id': 'test'}).clip('private-token', 'device', 1000, '0')
    assert data[4:8] == b'ftyp' and metadata['X-Media-Length'] == '12000'
    payload = json.loads(calls[0].data)
    assert payload['timestamp'] == 1000 and payload['duration'] == 60000
    assert payload['components'] == [{'component_id': '0'}]
    assert payload['video_options']['codec'] == 'avc'
    assert calls[0].get_header('Authorization') == 'Bearer private-token'
    assert calls[1].get_header('Authorization') is None
    assert calls[1].method == 'GET'


@pytest.mark.parametrize('status', [403, 416, 425, 429])
def test_clip_errors_are_actionable_and_redacted(monkeypatch, status):
    class Opener:
        def open(self, request, timeout):
            raise urllib.error.HTTPError(request.full_url, status, 'private provider body', {}, None)
    monkeypatch.setattr('urllib.request.build_opener', lambda *args: Opener())
    with pytest.raises(HTTPException) as error:
        Provider({'client id': 'test'}).clip('private-token', 'device', 1000)
    assert error.value.status_code == status
    assert 'private' not in error.value.detail


def test_clip_rejects_untrusted_redirect(monkeypatch):
    class Opener:
        def open(self, request, timeout):
            raise urllib.error.HTTPError(request.full_url, 301, '', {'Location': 'https://attacker.example/video'}, None)
    monkeypatch.setattr('urllib.request.build_opener', lambda *args: Opener())
    with pytest.raises(HTTPException) as error:
        Provider({'client id': 'test'}).clip('private-token', 'device', 1000)
    assert error.value.status_code == 502

