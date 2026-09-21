"""Small dependency-free TwinForge client for provider-independent applications."""

import json
from urllib.request import Request, urlopen


class TwinForge:
    def __init__(self, base_url, token):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, path, method="GET", body=None, version=None):
        headers = {
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
        }
        if version is not None:
            headers["If-Match"] = f'"{version}"'
        request = Request(
            self.base_url + path,
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers=headers,
        )
        with urlopen(request, timeout=30) as response:
            if response.status == 204 or not response.length:
                return None
            return json.load(response)

    def asset(self, asset_id):
        """Fetch a private media asset as ``(media_type, bytes)``."""
        request = Request(
            self.base_url + "/v1/assets/" + asset_id,
            headers={"Authorization": "Bearer " + self.token},
        )
        with urlopen(request, timeout=30) as response:
            media_type = response.headers.get("Content-Type", "application/octet-stream")
            return media_type, response.read()

    def revision(self, revision_id):
        return self.request("/v1/revisions/" + revision_id)

    def query(self, revision_id, query):
        return self.request(f"/v1/revisions/{revision_id}/query", "POST", query)

    def observations(self, observations):
        return self.request(
            "/v1/observations:batch", "POST", {"observations": observations}
        )
