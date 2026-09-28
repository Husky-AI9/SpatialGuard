"""Demo mode: allowlisted accounts only, clearly simulated data, and a clean way out."""
import json
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from spatialguard_api import demo
from spatialguard_api.store import dump
from test_preview import setup  # noqa: F401  (pytest fixture)


def add_live_visit(store, x=6, y=2):
    """One real Ring visit: a person positioned at the counter just now."""
    at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    incident = {
        "id": "real_visit", "site_id": "site_demo", "revision_id": "rev_demo", "run_id": "run_real",
        "title": "Activity on Front camera", "rule": "Ring motion event", "started_at": at, "created_at": at,
        "evidence_mode": "live", "associations": [], "evidence_ids": [],
        "observations": [{
            "observation_id": "real_visit_0", "site_id": "site_demo", "revision_id": "rev_demo",
            "source_id": "camera_front", "observed_at": at, "received_at": at, "category": "person",
            "location": {"kind": "floor_point", "floor_id": "floor_0", "xy_m": [x, y], "uncertainty_radius_m": 0.3},
            "evidence": {"mode": "live"},
            "provenance": {"kind": "measured", "source_ids": [], "confirmed": False, "explanation": "Ring event."},
        }],
    }
    with store.connect() as db:
        db.execute("INSERT INTO incidents(id,site_id,run_id,data) VALUES (?,?,?,?)",
                   ("real_visit", "site_demo", "run_real", dump(incident)))

CAFE = {
    "name": "Demo café",
    "zones": [
        {"name": "Parking", "polygon_xy_m": [[8, 4], [11, 4], [11, 5.5], [8, 5.5]]},
        {"name": "Entrance", "polygon_xy_m": [[6, 4], [8, 4], [8, 5.5], [6, 5.5]]},
        {"name": "Counter", "polygon_xy_m": [[4, 0], [8, 0], [8, 4], [4, 4]]},
        {"name": "Seating", "polygon_xy_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
        {"name": "Window bar", "polygon_xy_m": [[0, 5.5], [4, 5.5], [4, 8.5], [0, 8.5]]},
    ],
    "simulated_camera_ids": ["camera_hall"],
}
ROUTES = [("GET", "/v1/demo/sites/site_demo", None),
          ("POST", "/v1/demo/sites/site_demo/cafe", CAFE),
          ("POST", "/v1/demo/sites/site_demo/history", {}),
          ("POST", "/v1/demo/sites/site_demo/rush", {"interval_seconds": 0}),
          ("DELETE", "/v1/demo/sites/site_demo/simulated", None)]


def call(client, method, path, body=None):
    return client.request(method, path, json=body) if body is not None else client.request(method, path)


def cafe(client):
    response = client.post("/v1/demo/sites/site_demo/cafe", json=CAFE)
    assert response.status_code == 200, response.text
    return response.json()


def test_demo_tools_do_not_exist_for_other_accounts(setup, monkeypatch):
    app, c, store, engine = setup
    monkeypatch.setenv(demo.ENV, "someone@example.com")
    assert c.get("/v1/me").json()["demo_tools"] is False
    for method, path, body in ROUTES:
        assert call(c, method, path, body).status_code == 404, path
    # Allowlisting by email never matches an account ID sent by the caller.
    assert demo.allowed("SOMEONE@example.com") and not demo.allowed("local_owner")
    outsider = TestClient(app)
    assert outsider.get("/v1/demo/sites/site_demo").status_code == 401


def test_cafe_areas_replace_house_rooms_in_analytics(setup, monkeypatch):
    app, c, store, engine = setup
    monkeypatch.setenv(demo.ENV, "local")
    assert c.get("/v1/me").json()["demo_tools"] is True
    site = cafe(c)
    assert site["name"] == "Demo café" and site["simulated_camera_ids"] == ["camera_hall"]
    zones = [z for z in site["layout"]["zones"] if z["purpose"] == "analytics"]
    assert {z["name"] for z in zones} == {"Parking", "Entrance", "Counter", "Seating", "Window bar"}
    assert all(z["provenance"]["confirmed"] for z in zones)
    names = {z["name"] for z in c.get("/v1/sites/site_demo/analytics").json()["zones"]}
    assert "Study" not in names and "Kitchen" not in names and "Counter" in names
    alerts = {z["name"]: z["limit"] for z in c.get("/v1/sites/site_demo/alerts").json()["settings"]["zones"]}
    assert alerts["Counter"] == 3 and alerts["Entrance"] is None and alerts["Parking"] is None
    # Removing a simulated camera from the map drops it from the simulated list.
    site = c.delete("/v1/sites/site_demo/cameras/camera_hall").json()
    assert site["simulated_camera_ids"] == []


def test_simulated_history_is_labelled_and_live_only_leaves_it_out(setup, monkeypatch):
    app, c, store, engine = setup
    monkeypatch.setenv(demo.ENV, "local")
    cafe(c)
    add_live_visit(store)
    status = c.post("/v1/demo/sites/site_demo/history", json={"tz": "America/Los_Angeles", "seed": 3}).json()
    assert status["simulated_visits"] > 500 and status["live_visits"] == 1
    with store.connect() as db:
        stored = [json.loads(r[0]) for r in db.execute("SELECT data FROM incidents WHERE run_id LIKE 'demo-sim-%'")]
    assert all(i["simulated"] and i["evidence_mode"] == "replay" and i["title"] == "Simulated customer" for i in stored)
    first = stored[0]["observations"][0]
    assert first["location"]["kind"] == "floor_point" and first["provenance"]["kind"] == "inferred"
    assert "not a camera observation" in first["provenance"]["explanation"]
    everything = c.get("/v1/sites/site_demo/analytics?tz=America/Los_Angeles").json()
    assert everything["mode"] == "all" and everything["simulated_visits"] > 200
    assert everything["totals"]["visits"] == everything["simulated_visits"] + 1
    live = c.get("/v1/sites/site_demo/analytics?mode=live&tz=America/Los_Angeles").json()
    assert live["mode"] == "live" and live["totals"]["visits"] == 1
    assert live["simulated_visits"] == everything["simulated_visits"]
    assert c.get("/v1/sites/site_demo/analytics?mode=fake").status_code == 422
    # The same seed gives the same café; history never reaches the last few minutes.
    again = c.post("/v1/demo/sites/site_demo/history", json={"tz": "America/Los_Angeles", "seed": 3}).json()
    assert again["simulated_visits"] == status["simulated_visits"]
    latest = max(i["created_at"] for i in stored)
    assert datetime.fromisoformat(latest.replace("Z", "+00:00")) < datetime.now(timezone.utc) - demo.SETTLE
    heat = c.get("/v1/sites/site_demo/heatmap?window=24h").json()
    assert heat["simulated"] > 0


def test_simulated_customers_never_count_as_a_camera_sighting(setup, monkeypatch):
    app, c, store, engine = setup
    monkeypatch.setenv(demo.ENV, "local")
    cafe(c)
    assert c.post("/v1/demo/sites/site_demo/history", json={"seed": 5}).status_code == 200
    with store.connect() as db:
        sources = {o["source_id"] for (data,) in db.execute("SELECT data FROM incidents")
                   for o in json.loads(data)["observations"]}
    assert "camera_front" in sources  # the parking area is in the front camera's view
    cameras = {cam["id"]: cam for cam in c.get("/v1/sites/site_demo/cameras").json()}
    assert cameras["camera_front"]["last_observed_at"] is None


def test_a_lunch_rush_raises_a_simulated_queue_alert_and_clearing_keeps_real_visits(setup, monkeypatch):
    app, c, store, engine = setup
    monkeypatch.setenv(demo.ENV, "local")
    cafe(c)
    add_live_visit(store)
    status = c.post("/v1/demo/sites/site_demo/rush", json={"customers": 4, "interval_seconds": 0})
    assert status.status_code == 202 and status.json()["simulated_visits"] == 4
    raised = c.get("/v1/sites/site_demo/alerts").json()["alerts"]
    assert [(a["zone"], a["simulated"]) for a in raised] == [("Counter", True)]
    # Rush customers are fresh, so the apps animate them, and they are marked simulated.
    page = c.get("/v1/sites/site_demo/incidents").json()["incidents"]
    assert sum(1 for i in page if i["simulated"]) == 4
    cleared = c.delete("/v1/demo/sites/site_demo/simulated").json()
    assert cleared == {**cleared, "simulated_visits": 0, "live_visits": 1, "rush_active": False}
    assert c.get("/v1/sites/site_demo/alerts").json()["alerts"] == []
    assert [i["id"] for i in c.get("/v1/sites/site_demo/incidents").json()["incidents"]] == ["real_visit"]


def test_a_rush_needs_a_counter_area(setup, monkeypatch):
    app, c, store, engine = setup
    monkeypatch.setenv(demo.ENV, "local")
    assert c.post("/v1/demo/sites/site_demo/rush", json={"interval_seconds": 0}).status_code == 409
    assert c.post("/v1/demo/sites/site_demo/history", json={}).status_code == 409


def test_the_simulated_cafe_has_a_believable_week():
    from zoneinfo import ZoneInfo
    from spatialguard_api import analytics
    from twinforge.fixture import synthetic_layout
    layout = synthetic_layout().model_dump(mode="json")
    layout["zones"] = [{"id": f"z{i}", "floor_id": "floor_0", "name": z["name"], "purpose": "analytics",
                        "polygon_xy_m": z["polygon_xy_m"],
                        "provenance": {"kind": "manual", "source_ids": [], "confirmed": True, "explanation": "test"}}
                       for i, z in enumerate(CAFE["zones"])]
    site = {"id": "site_demo", "name": "Demo café", "revision_id": "rev_demo", "layout": layout}
    tz = ZoneInfo("America/Los_Angeles")
    for hour in (8, 20):  # early and late in the day
        now = datetime(2026, 9, 28, hour, tzinfo=tz).astimezone(timezone.utc)
        incidents = demo.history(site, now, tz, seed=9)
        result = analytics.build(site, incidents, {}, "America/Los_Angeles", now=now)
        assert result["totals"]["change_pct"] > 0
        assert result["totals"]["peak_hour"] in (12, 13)  # the lunch rush
        zones = {z["name"]: z for z in result["zones"]}
        assert zones["Counter"]["visits"] >= zones["Seating"]["visits"] > zones["Window bar"]["visits"] > 0
        assert zones["Seating"]["dwell_s"] > zones["Counter"]["dwell_s"]


def test_a_separate_demo_cafe_is_created_from_its_drawing(setup, monkeypatch):
    import base64
    import io
    from PIL import Image
    app, c, store, engine = setup
    buffer = io.BytesIO()
    Image.new("RGB", (300, 380), "white").save(buffer, "PNG")
    body = {
        "name": "Demo café", "drawing_png_base64": base64.b64encode(buffer.getvalue()).decode(),
        "drawing_origin_xy_m": [-1.5, -9], "drawing_width_m": 15, "drawing_height_m": 19,
        "rooms": [{"name": "Café", "polygon_xy_m": [[0, 0], [12, 0], [12, 6.5], [0, 6.5]]}],
        "zones": [{"name": "Counter", "polygon_xy_m": [[6, 3.6], [11.8, 3.6], [11.8, 5.3], [6, 5.3]]},
                  {"name": "Entrance", "polygon_xy_m": [[4, -2], [8, -2], [8, 1], [4, 1]]},
                  {"name": "Seating", "polygon_xy_m": [[0.2, 1.5], [5.8, 1.5], [5.8, 6.3], [0.2, 6.3]]}],
        "cameras": [{"name": "Front door", "position_m": [6.5, -0.1, 1.3], "heading_degrees": 270},
                    {"name": "Seating", "position_m": [0.3, 6.2, 2.6], "heading_degrees": -40, "simulated": True}],
    }
    monkeypatch.setenv(demo.ENV, "someone@example.com")
    assert c.post("/v1/demo/sites", json=body).status_code == 404
    monkeypatch.setenv(demo.ENV, "local")
    site = c.post("/v1/demo/sites", json=body).json()
    cameras = {cam["name"]: cam["id"] for cam in site["layout"]["cameras"]}
    assert site["name"] == "Demo café" and site["layout"]["floor_plan"]["width_m"] == 15
    assert site["simulated_camera_ids"] == [cameras["Seating"]]
    assert site["monitoring"] == {**site["monitoring"], "enabled": True, "camera_ids": [cameras["Front door"]]}
    assert {z["name"] for z in site["layout"]["zones"]} == {"Counter", "Entrance", "Seating"}
    # The house place is untouched, and the café opens next.
    assert {s["name"] for s in c.get("/v1/sites").json()} == {"Demo home", "Demo café"}
    assert c.get("/v1/preferences").json()["active_site_id"] == site["id"]
    status = c.post(f"/v1/demo/sites/{site['id']}/history", json={"seed": 2}).json()
    assert status["simulated_visits"] > 500
    duplicate = {**body, "cameras": body["cameras"] + [body["cameras"][0]]}
    assert c.post("/v1/demo/sites", json=duplicate).status_code == 422
