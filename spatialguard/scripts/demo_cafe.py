"""Create the "Demo café" place from a real coffee-shop floor plan (CC0, see below).

The map geometry below is measured from the same drawing, so rooms, business areas
and cameras line up with the picture. Three camera spots are for real Ring cameras
(pair them in the app); two are simulated and labelled SIM.

    PL_EMAIL=you@example.com PL_PASSWORD=... python spatialguard/scripts/demo_cafe.py --base https://your-host
    python spatialguard/scripts/demo_cafe.py --local        # local development owner

Your account must be listed in PATHLIGHT_DEMO_ACCOUNTS on the server.
Simulated customers are then created from the app: Settings > Demo mode.
"""

import argparse
import base64
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request

from pathlib import Path

NAME = "Demo café"
# The floor plan is the CC0 "Coffee Shop Floor Plan CAD Block" from OpenCAD Library
# (https://opencadlibrary.com/c10136-coffee-shop-floor-plan-cad-block/), rendered to
# scale with its dimensions and drawn people removed, turned so the entrance faces the
# street, with a sidewalk and car park added. The building is 28.2 x 8.3 m. Map metres:
# +x across the café, +y from the street towards the back lounge.
PLAN = Path(__file__).with_name("demo-cafe-plan.png")
DRAWING = {"origin": (-1.5, -11.5), "width": 11.3, "height": 40.3}
ROOMS = [
    {"name": "Café", "polygon_xy_m": [(4.12, 25.794), (8.255, 25.794), (8.255, 1.994), (0, 1.994), (0, 24.124), (4.12, 24.124)]},
    {"name": "Lounge", "polygon_xy_m": [(0, 24.124), (4.12, 24.124), (4.12, 28.194), (0, 28.194)]},
]
ZONES = [
    {"name": "Counter", "polygon_xy_m": [(2.0, 4.19), (3.9, 4.19), (3.9, 11.19), (2.0, 11.19)]},
    {"name": "Window bar", "polygon_xy_m": [(0.15, 4.19), (1.95, 4.19), (1.95, 10.99), (0.15, 10.99)]},
    {"name": "Entrance", "polygon_xy_m": [(0, -3.0), (8.255, -3.0), (8.255, 4.19), (0, 4.19)]},
    {"name": "Seating", "polygon_xy_m": [(0.15, 11.19), (8.1, 11.19), (8.1, 25.79), (4.12, 25.79), (4.12, 24.12), (0.15, 24.12)]},
    {"name": "Lounge", "polygon_xy_m": [(0.15, 24.2), (4.05, 24.2), (4.05, 28.05), (0.15, 28.05)]},
    {"name": "Parking", "polygon_xy_m": [(-1.2, -11.0), (9.5, -11.0), (9.5, -3.2), (-1.2, -3.2)]},
]
CAMERAS = [
    {"name": "Front door", "position_m": (3.4, 1.9, 1.3), "heading_degrees": -90, "range_m": 5},
    {"name": "Parking lot", "position_m": (8.0, 0.0, 2.6), "heading_degrees": -130, "range_m": 9},
    {"name": "Counter", "position_m": (0.4, 4.1, 2.4), "heading_degrees": 70, "range_m": 8},
    {"name": "Seating", "position_m": (7.9, 23.8, 2.6), "heading_degrees": -110, "range_m": 11, "simulated": True},
    {"name": "Window bar", "position_m": (3.4, 11.4, 2.6), "heading_degrees": -120, "range_m": 7, "simulated": True},
]


def drawing() -> bytes:
    return PLAN.read_bytes()


def payload() -> dict:
    return {
        "name": NAME,
        "drawing_png_base64": base64.b64encode(drawing()).decode(),
        "drawing_origin_xy_m": DRAWING["origin"], "drawing_width_m": DRAWING["width"], "drawing_height_m": DRAWING["height"],
        "rooms": ROOMS, "zones": ZONES,
        "cameras": [{**c, "simulated": c.get("simulated", False)} for c in CAMERAS],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base", default="http://127.0.0.1:8010")
    parser.add_argument("--local", action="store_true", help="use the local development owner")
    parser.add_argument("--preview", help="only write the drawing to this PNG file")
    args = parser.parse_args()
    if args.preview:
        open(args.preview, "wb").write(drawing())
        print(f"Wrote {args.preview}")
        return
    base = args.base.rstrip("/")
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(method, path, body=None):
        headers = {"Content-Type": "application/json", "Origin": base}
        if args.local:
            headers["X-SpatialGuard-Local"] = "1"
        request = urllib.request.Request(base + path, method=method, headers=headers,
                                         data=None if body is None else json.dumps(body).encode())
        try:
            with opener.open(request, timeout=180) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            sys.exit(f"{method} {path} failed ({error.code}): {error.read().decode(errors='replace')[:300]}")

    if args.local:
        call("POST", "/v1/local-session")
    else:
        email, password = os.environ.get("PL_EMAIL"), os.environ.get("PL_PASSWORD")
        if not email or not password:
            sys.exit("Set PL_EMAIL and PL_PASSWORD (or use --local).")
        call("POST", "/v1/auth/signin", {"email": email, "password": password})
    if not call("GET", "/v1/me").get("demo_tools"):
        sys.exit("Demo mode is off for this account. Add it to PATHLIGHT_DEMO_ACCOUNTS on the server.")
    if any(site["name"] == NAME for site in call("GET", "/v1/sites")):
        sys.exit(f'"{NAME}" already exists. Remove it in the app first to create it again.')
    site = call("POST", "/v1/demo/sites", payload())
    print(f'Created "{site["name"]}" ({site["id"]}) with {len(site["layout"]["cameras"])} cameras.')
    print("Next: pair Front door, Parking lot and Counter with your Ring cameras, then")
    print("Settings > Demo mode > Create two simulated weeks.")


if __name__ == "__main__":
    main()
