import io
import json
from datetime import datetime, timedelta, timezone

import pytest

from spatialguard_api import analytics, insights
from test_preview import setup  # noqa: F401  (pytest fixture)

NOW = datetime(2026, 9, 27, 18, 0, tzinfo=timezone.utc)  # Sunday 11:00 in Los Angeles
FRONT = {"id": "front", "name": "Front door", "position_m": [1, 4, 2.2], "heading_degrees": 0, "fov_degrees": 110, "range_m": 5}
SIDE = {"id": "side", "name": "Side door", "position_m": [9, 1, 2.2], "heading_degrees": 90, "fov_degrees": 110, "range_m": 4}
SITE = {
    "id": "site_a",
    "name": "Corner Café",
    "layout": {
        "floors": [{"id": "floor_0"}],
        "rooms": [
            {"id": "r1", "name": "Counter", "polygon_xy_m": [[0, 0], [5, 0], [5, 8], [0, 8]]},
            {"id": "r2", "name": "Seating", "polygon_xy_m": [[5, 0], [10, 0], [10, 8], [5, 8]]},
        ],
        "zones": [{"id": "z1", "name": "Queue", "polygon_xy_m": [[1, 3], [3, 3], [3, 5], [1, 5]]}],
        "cameras": [FRONT, SIDE],
    },
}


def iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def live(incident_id: str, at: datetime, camera: str = "front", observation: str | None = None) -> dict:
    return {"id": incident_id, "evidence_mode": "live", "created_at": iso(at),
            "observations": [{"observation_id": observation or incident_id + "_o", "source_id": camera,
                              "observed_at": iso(at), "category": "motion_detected",
                              "location": {"kind": "unknown", "reason": "ring"}}]}


def replay(incident_id: str, at: datetime, points: list[tuple[float, float, float]]) -> dict:
    """Positioned sightings at (seconds after `at`, x, y)."""
    return {"id": incident_id, "evidence_mode": "live", "created_at": iso(at),
            "observations": [{"observation_id": f"{incident_id}_{i}", "source_id": "front",
                              "observed_at": iso(at + timedelta(seconds=t)), "category": "person",
                              "location": {"kind": "floor_point", "floor_id": "floor_0", "xy_m": [x, y],
                                           "uncertainty_radius_m": 0.3}} for i, (t, x, y) in enumerate(points)]}


def test_this_week_is_compared_with_last_week_by_local_day_and_hour():
    this_week = [live(f"now{i}", NOW - timedelta(days=1, hours=i % 3)) for i in range(6)]
    last_week = [live(f"old{i}", NOW - timedelta(days=8)) for i in range(3)]
    result = analytics.build(SITE, this_week + last_week, {}, "America/Los_Angeles", now=NOW)
    assert result["totals"]["visits"] == 6 and result["totals"]["previous"] == 3
    assert result["totals"]["change_pct"] == 100.0
    assert [d["date"] for d in result["daily"]][-1] == "2026-09-27"  # today, local
    saturday = result["daily"][-2]
    # Compared with the same weekday a week earlier.
    assert saturday["visits"] == 6 and saturday["previous"] == 3
    assert result["daily"][-2]["date"] == "2026-09-26"
    # 18:00, 17:00 and 16:00 UTC are 11:00, 10:00 and 09:00 in Los Angeles.
    busy = {h["hour"]: h["visits"] for h in result["hourly"] if h["visits"]}
    assert busy == {9: 2, 10: 2, 11: 2}
    assert result["totals"]["peak_hour"] in {9, 10, 11}
    assert sum(map(sum, result["week_grid"])) == 6


def test_zones_dwell_and_entrances_come_from_paths_and_first_cameras():
    # Positioned visit: 20 s in the queue, then 10 s at the seating area.
    a = replay("a", NOW - timedelta(hours=2), [(0, 2, 4), (10, 2.2, 4), (20, 2.4, 4.2), (25, 7, 4), (35, 7.5, 4)])
    # Tracked Ring visit through the side door.
    b = live("b", NOW - timedelta(hours=3), camera="side")
    walk = {"state": "done", "points": [[t, 0.5, 0.95, 0.9] for t in (0, 1, 2, 3)]}
    result = analytics.build(SITE, [a, b], {("b", "b_o"): walk}, "UTC", now=NOW)
    zones = {z["name"]: z for z in result["zones"]}
    assert zones["Queue"]["visits"] == 1 and zones["Queue"]["dwell_s"] == 20
    assert zones["Seating"]["visits"] == 2 and zones["Seating"]["dwell_s"] == pytest.approx(6.5)
    assert zones["Counter"]["visits"] == 0
    assert result["totals"]["busiest_zone"] == "Seating" and result["totals"]["quietest_zone"] == "Counter"
    entrances = {e["name"]: e["visits"] for e in result["entrances"]}
    assert entrances == {"Front door": 1, "Side door": 1}
    assert result["quality"] == {"tracked": 1, "positioned": 1, "estimated": 0}
    assert result["totals"]["avg_visit_s"] == pytest.approx(19)


def test_events_without_a_person_are_not_visits():
    car = live("car", NOW - timedelta(hours=1))
    person = live("person", NOW - timedelta(hours=1))
    result = analytics.build(SITE, [car, person], {("car", "car_o"): {"state": "no_person", "points": []}}, "UTC", now=NOW)
    assert result["totals"]["visits"] == 1
    assert result["quality"] == {"tracked": 0, "positioned": 0, "estimated": 1}


def test_unknown_time_zones_fall_back_to_utc():
    result = analytics.build(SITE, [live("x", NOW - timedelta(hours=1))], {}, "Not/AZone", now=NOW)
    assert result["time_zone"] == "UTC"
    assert result["hourly"][17]["visits"] == 1


def test_insight_facts_carry_only_aggregates():
    result = analytics.build(SITE, [live("x", NOW - timedelta(hours=1))], {}, "UTC", now=NOW)
    facts = json.dumps(insights._facts(result))
    assert "x_o" not in facts and "front" not in facts and "Front door" in facts


def test_analytics_endpoints_and_bedrock_insight(setup, monkeypatch):  # noqa: F811
    app, client, store, engine = setup
    empty = client.get("/v1/sites/site_demo/analytics?tz=America/New_York")
    assert empty.status_code == 200
    body = empty.json()
    assert body["totals"]["visits"] == 0 and len(body["daily"]) == 7 and len(body["hourly"]) == 24
    overview = client.get("/v1/analytics/sites?tz=UTC").json()
    assert any(row["site_id"] == "site_demo" for row in overview)
    assert client.get("/v1/sites/site_missing/analytics").status_code == 404

    monkeypatch.setattr(insights, "_settings", lambda: {"AWS_BEARER_TOKEN_BEDROCK": "", "AWS_REGION": "us-west-2",
                                                        "PATHLIGHT_INSIGHT_MODEL": insights.DEFAULT_MODEL})
    state = client.get("/v1/sites/site_demo/analytics/insight").json()
    assert state["available"] is False and state["insight"] is None and state["stale"] is True
    assert client.post("/v1/sites/site_demo/analytics/insight", json={"tz": "UTC"}).status_code == 503

    sent = {}
    monkeypatch.setattr(insights, "_settings", lambda: {"AWS_BEARER_TOKEN_BEDROCK": "test-key", "AWS_REGION": "us-west-2",
                                                        "PATHLIGHT_INSIGHT_MODEL": insights.DEFAULT_MODEL})

    def fake_urlopen(request, timeout):
        sent["url"], sent["auth"] = request.full_url, request.headers.get("Authorization")
        sent["body"] = json.loads(request.data)
        reply = {"output": {"message": {"content": [{"text": json.dumps({
            "headline": "A quiet week", "summary": "No visits yet.", "extra": "ignored",
            "highlights": [{"title": "No traffic", "detail": "0 visits.", "trend": "flat", "x": 1}],
            "recommendation": "Pair a camera at the entrance."})}]}}, "usage": {"inputTokens": 10, "outputTokens": 20}}
        return io.BytesIO(json.dumps(reply).encode())

    monkeypatch.setattr(insights.urllib.request, "urlopen", fake_urlopen)
    created = client.post("/v1/sites/site_demo/analytics/insight", json={"tz": "UTC"})
    assert created.status_code == 200
    insight = created.json()["insight"]
    assert insight["headline"] == "A quiet week" and insight["provider"] == "Amazon Bedrock"
    assert insight["highlights"] == [{"title": "No traffic", "detail": "0 visits.", "trend": "flat"}]
    assert "bedrock-runtime.us-west-2.amazonaws.com" in sent["url"] and sent["auth"] == "Bearer test-key"
    assert "converse" in sent["url"] and sent["body"]["system"]
    assert client.get("/v1/sites/site_demo/analytics/insight").json()["stale"] is False
