"""Reset and seed the isolated reviewer account through public APIs only.

Usage: python spatialguard/scripts/judge-demo.py https://your-service.up.railway.app
The test account is intentionally isolated from the owner's Ring connection.
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.request

origin = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8010").rstrip("/")
email = os.environ.get("SPATIALGUARD_REVIEWER_EMAIL", "test12345@gmail.com")
password = os.environ.get("SPATIALGUARD_REVIEWER_PASSWORD", "test12345")
reviewer_key = os.environ.get("SPATIALGUARD_REVIEWER_KEY", "")
cookies = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))


def call(path, method="GET", body=None):
    headers = {"Origin": origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json"}
    if reviewer_key:
        headers["X-SpatialGuard-Reviewer-Key"] = reviewer_key
    request = urllib.request.Request(origin + path, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
    with client.open(request, timeout=30) as response:
        return None if response.status == 204 else json.load(response)


call("/v1/auth/signin", "POST", {"email": email, "password": password})
for site in call("/v1/sites"):
    call("/v1/sites/" + site["id"], "DELETE")
site = call("/v1/sample-site", "POST")
request_id = "reviewer-seed-" + str(int(time.time()))
run = call(f"/v1/sites/{site['id']}/replay", "POST", {"request_id": request_id})
print(json.dumps({"site": site["name"], "replay": run["id"], "mode": "synthetic replay"}, indent=2))
