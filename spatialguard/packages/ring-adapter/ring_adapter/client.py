"""Ring Partner API calls. Provider payloads are normalised before leaving here."""
import json
import time
import urllib.error
import urllib.request

BASE_URL = "https://api.amazonvision.com"


class RingUnavailable(Exception):
    """Ring could not be reached, or refused the request. Safe to show an owner."""


class RingClient:
    """Reads devices and events for one linked account.

    ``token`` is either a TokenStore (normal operation) or a plain string,
    which is how a short-lived Playground token is used for testing.
    """

    def __init__(self, token, base_url=BASE_URL, opener=None):
        self._token = token
        self.base_url = base_url.rstrip("/")
        self._opener = opener or self._get

    def _bearer(self):
        return self._token if isinstance(self._token, str) else self._token.access_token()

    def _get(self, path, token):
        request = urllib.request.Request(
            self.base_url + path,
            headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def request(self, path, attempts=3):
        """One GET, retrying 429 and 5xx with exponential backoff."""
        delay = 1.0
        for attempt in range(attempts):
            try:
                return self._opener(path, self._bearer())
            except urllib.error.HTTPError as error:
                retryable = error.code == 429 or error.code >= 500
                if not retryable or attempt == attempts - 1:
                    if error.code in (401, 403):
                        raise RingUnavailable("Ring rejected the request; relink the account") from None
                    raise RingUnavailable("Ring is unavailable. Try again shortly.") from None
                # Honour Retry-After when Ring sends one.
                wait = error.headers.get("Retry-After") if error.headers else None
                time.sleep(float(wait) if wait else delay)
                delay *= 2
            except OSError:
                if attempt == attempts - 1:
                    raise RingUnavailable("Ring is unreachable. Check the connection.") from None
                time.sleep(delay)
                delay *= 2
        raise RingUnavailable("Ring is unavailable. Try again shortly.")

    def devices(self):
        """Cameras on the linked account, with status and location."""
        payload = self.request("/v1/devices?include=status,capabilities,location")
        return payload.get("devices", payload if isinstance(payload, list) else [])

    def device_status(self, device_id):
        return self.request(f"/v1/devices/{device_id}/status")

    def events(self, device_id):
        payload = self.request(f"/v1/history/devices/{device_id}/events")
        return payload.get("events", payload if isinstance(payload, list) else [])
