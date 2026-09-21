import json
import time
import urllib.error
import pytest
from ring_adapter import AppCredentials, RingClient, RingUnavailable, TokenStore, load_credentials
from ring_adapter.tokens import RingAuthError

CREDS = AppCredentials("test_abc", "secret-value", "hmac-value")


def csv_file(tmp_path, text):
    path = tmp_path / "app-credentials.csv"
    path.write_text(text, encoding="utf-8-sig")
    return path


def test_credentials_parse_the_console_export_and_never_print_secrets(tmp_path):
    path = csv_file(tmp_path, "Client ID,test_X8\nClient Secret,super-secret\nHMAC Signature Key,hmac-key\n")
    creds = load_credentials(path)
    assert creds.client_id == "test_X8" and creds.client_secret == "super-secret"
    assert creds.hmac_signing_key == "hmac-key" and creds.staging
    # A secret must not leak through a log line or traceback.
    assert "super-secret" not in repr(creds) and "hmac-key" not in repr(creds)
    with pytest.raises(ValueError, match="client_secret"):
        load_credentials(csv_file(tmp_path, "Client ID,test_X8\n"))
    with pytest.raises(FileNotFoundError):
        load_credentials(tmp_path / "absent.csv")


def test_the_rotated_refresh_token_is_on_disk_before_the_old_one_is_used_again(tmp_path):
    issued = []

    def opener(fields):
        issued.append(fields)
        n = len(issued)
        return {"access_token": f"access-{n}", "refresh_token": f"refresh-{n}", "expires_in": 14400}

    store = TokenStore(tmp_path / "tokens.json", CREDS, opener=opener)
    store.exchange("code-1", redirect_uri="https://example.test/cb")
    assert issued[0]["grant_type"] == "authorization_code"
    assert issued[0]["client_secret"] == "secret-value"
    assert store.read().refresh_token == "refresh-1"
    store.refresh()
    assert issued[1] == {"grant_type": "refresh_token", "refresh_token": "refresh-1",
                         "client_id": "test_abc", "client_secret": "secret-value"}
    # Rotation is persisted, so a restart never replays a dead refresh token.
    assert TokenStore(tmp_path / "tokens.json", CREDS).read().refresh_token == "refresh-2"


def test_an_expiring_access_token_is_refreshed_before_it_is_used(tmp_path):
    calls = []

    def opener(fields):
        calls.append(fields["grant_type"])
        return {"access_token": "fresh", "refresh_token": "next", "expires_in": 14400}

    store = TokenStore(tmp_path / "tokens.json", CREDS, opener=opener)
    store.exchange("code")
    assert store.access_token() == "fresh" and calls == ["authorization_code"]
    # Within the refresh margin of expiry it renews rather than handing out a dying token.
    current = store.read()
    current.expires_at = time.time() + 60
    store.write(current)
    assert store.access_token() == "fresh"
    assert calls == ["authorization_code", "refresh_token"]


def test_a_dead_grant_is_reported_as_needing_a_relink(tmp_path):
    def reject(fields):
        raise urllib.error.HTTPError("url", 400, "invalid_grant", None, None)

    store = TokenStore(tmp_path / "tokens.json", CREDS, opener=reject)
    with pytest.raises(RingAuthError):
        store.exchange("stale-code")
    assert not (tmp_path / "tokens.json").exists(), "a failed exchange stores nothing"
    with pytest.raises(RingAuthError, match="No Ring account is linked"):
        store.access_token()


def test_devices_and_events_read_through_with_a_plain_playground_token():
    seen = []

    def opener(path, token):
        seen.append((path, token))
        if path.startswith("/v1/devices?"):
            return {"devices": [{"id": "dev_1", "description": "Front Door"}]}
        return {"events": [{"event_id": "e1", "kind": "motion"}]}

    client = RingClient("playground-token", opener=opener)
    assert client.devices()[0]["id"] == "dev_1"
    assert client.events("dev_1")[0]["event_id"] == "e1"
    assert all(token == "playground-token" for _, token in seen)
    assert seen[0][0] == "/v1/devices?include=status,capabilities,location"
    assert seen[1][0] == "/v1/history/devices/dev_1/events"


def test_rate_limits_are_retried_and_auth_failures_are_not(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda _: None)
    attempts = []

    def throttled(path, token):
        attempts.append(path)
        if len(attempts) < 3:
            raise urllib.error.HTTPError("url", 429, "slow down", {"Retry-After": "0"}, None)
        return {"devices": []}

    assert RingClient("t", opener=throttled).devices() == []
    assert len(attempts) == 3

    def unauthorised(path, token):
        raise urllib.error.HTTPError("url", 401, "nope", None, None)

    with pytest.raises(RingUnavailable, match="relink"):
        RingClient("t", opener=unauthorised).devices()


def test_the_owners_real_credentials_file_loads_if_present():
    from pathlib import Path
    path = Path(__file__).resolve().parents[2] / ".data" / "ring-app-credentials.csv"
    if not path.exists():
        pytest.skip("no local Ring credentials configured")
    creds = load_credentials(path)
    assert creds.client_id and creds.client_secret and creds.hmac_signing_key
