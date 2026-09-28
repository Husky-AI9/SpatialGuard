import json
from datetime import datetime, timedelta, timezone

from spatialguard_api import alerts
from spatialguard_api.store import Store
from test_analytics import SITE, replay
from test_preview import run, setup  # noqa: F401  (pytest fixture)

NOW = datetime.now(timezone.utc)
SHOP = {**SITE, "layout": {**SITE["layout"], "rooms": [
    *SITE["layout"]["rooms"], {"id": "r3", "name": "Checkout", "polygon_xy_m": [[10, 0], [14, 0], [14, 4], [10, 4]]}]}}


def store_with(tmp_path, site=SHOP):
    store = Store(tmp_path / "alerts.sqlite3")
    with store.connect() as db:
        db.execute("INSERT INTO sites VALUES (?,?,?)", (site["id"], "owner", json.dumps(site)))
    return store


def add(store, incident):
    with store.connect() as db:
        db.execute("INSERT INTO incidents(id,site_id,run_id,data) VALUES (?,?,?,?)",
                   (incident["id"], SHOP["id"], "run_" + incident["id"], json.dumps({**incident, "site_id": SHOP["id"]})))


def shopper(name, minutes_ago, x=12, y=2):
    """One visitor standing at (x, y) for 20 seconds, some minutes ago."""
    at = NOW - timedelta(minutes=minutes_ago)
    return replay(name, at, [(0, x, y), (10, x, y), (20, x, y)])


def test_places_people_wait_are_queue_zones():
    assert alerts.zone_kind("Checkout") == "queue" and alerts.zone_kind("Coffee counter") == "queue"
    assert alerts.zone_kind("Main entrance") == "queue" and alerts.zone_kind("Seating") == "crowding"


def test_default_limits_and_owner_settings(tmp_path):
    store = store_with(tmp_path)
    with store.connect() as db:
        config = alerts.settings(db, SHOP)
        limits = {z["name"]: (z["kind"], z["limit"]) for z in config["zones"]}
        assert limits["Checkout"] == ("queue", alerts.QUEUE_LIMIT)
        assert limits["Seating"] == ("crowding", alerts.CROWD_LIMIT)
        assert config["enabled"] and config["window_minutes"] == 5
        saved = alerts.save_settings(db, SHOP, True, 10, {"Checkout": 2, "Seating": None, "Nowhere": 4})
        limits = {z["name"]: z["limit"] for z in saved["zones"]}
        assert limits["Checkout"] == 2 and limits["Seating"] is None and "Nowhere" not in limits
        assert saved["window_minutes"] == 10


def test_a_queue_building_raises_one_alert_until_acknowledged(tmp_path):
    store = store_with(tmp_path)
    for i in range(2):
        add(store, shopper(f"s{i}", 1))
    with store.connect() as db:
        assert alerts.evaluate(db, SHOP["id"]) == []  # two people: under the limit of three
    add(store, shopper("s2", 2))
    with store.connect() as db:
        raised = alerts.evaluate(db, SHOP["id"])
    assert [(a["zone"], a["kind"], a["count"]) for a in raised] == [("Checkout", "queue", 3)]
    add(store, shopper("s3", 0))
    with store.connect() as db:
        # Still one unacknowledged alert for this queue: no repeat.
        assert alerts.evaluate(db, SHOP["id"]) == []
        assert db.execute("SELECT kind FROM events WHERE kind='alert.crowding'").fetchall()
        db.execute("UPDATE site_alerts SET acknowledged=1")
        again = alerts.evaluate(db, SHOP["id"])
    assert again and again[0]["count"] == 4


def test_only_visitors_inside_the_window_count(tmp_path):
    store = store_with(tmp_path)
    for i in range(3):
        add(store, shopper(f"old{i}", 20))  # recorded long before the 5-minute window
    add(store, shopper("new", 1))
    with store.connect() as db:
        assert alerts.evaluate(db, SHOP["id"]) == []
        assert alerts.live(db, SHOP) == [{"name": "Checkout", "kind": "queue", "count": 1, "limit": 3}]


def test_zones_turned_off_never_alert(tmp_path):
    store = store_with(tmp_path)
    for i in range(5):
        add(store, shopper(f"s{i}", 1))
    with store.connect() as db:
        alerts.save_settings(db, SHOP, True, 5, {"Checkout": None})
        assert alerts.evaluate(db, SHOP["id"]) == []
        alerts.save_settings(db, SHOP, False, 5, {})
        assert alerts.evaluate(db, SHOP["id"]) == []


def test_demo_visits_raise_a_live_alert_through_the_api(setup):  # noqa: F811
    app, client, store, engine = setup
    body = client.get("/v1/sites/site_demo/alerts").json()
    assert body["alerts"] == [] and body["settings"]["enabled"] is True
    names = {z["name"] for z in body["settings"]["zones"]}
    assert client.put("/v1/sites/site_demo/alerts/settings",
                      json={"enabled": True, "window_minutes": 7, "limits": {}}).status_code == 422
    saved = client.put("/v1/sites/site_demo/alerts/settings",
                       json={"enabled": True, "window_minutes": 5, "limits": {name: 1 for name in names}})
    assert saved.status_code == 200
    run(setup)
    body = client.get("/v1/sites/site_demo/alerts").json()
    assert body["alerts"], "a demo visit over a limit of one raises an alert"
    alert = body["alerts"][0]
    assert alert["count"] >= 1 and alert["acknowledged"] is False and body["live"]
    assert client.post(f"/v1/sites/site_demo/alerts/{alert['id']}/acknowledge").status_code == 204
    assert client.post("/v1/sites/site_demo/alerts/999999/acknowledge").status_code == 404
    assert client.get("/v1/sites/site_demo/alerts").json()["alerts"][0]["acknowledged"] is True
