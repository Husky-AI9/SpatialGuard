import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from spatialguard_api import heatmap as hm
from spatialguard_api.store import digest
from test_preview import run, setup  # noqa: F401  (pytest fixture)

NOW = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)
SITE = {
    "id": "site_h",
    "layout": {
        "floors": [{"id": "floor_0"}],
        "rooms": [{"polygon_xy_m": [[0, 0], [10, 0], [10, 8], [0, 8]]}],
        "cameras": [],
    },
}


def iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def incident(created: datetime, observations: list[dict]) -> dict:
    return {"created_at": iso(created), "started_at": observations[0]["observed_at"], "observations": observations}


def point(at: datetime, x: float, y: float, uncertainty: float = 0.2, source: str = "cam") -> dict:
    return {"observed_at": iso(at), "source_id": source, "category": "person",
            "location": {"kind": "floor_point", "floor_id": "floor_0", "xy_m": [x, y], "uncertainty_radius_m": uncertainty}}


def cell_of(result: dict, x: float, y: float) -> float:
    column = int((x - result["origin_xy_m"][0]) / result["cell_m"])
    row = int((y - result["origin_xy_m"][1]) / result["cell_m"])
    return result["values"][row * result["columns"] + column]


def test_peak_sits_on_the_sighting_and_values_are_normalised():
    result = hm.build_heatmap(SITE, [incident(NOW, [point(NOW, 3, 4)])], NOW - timedelta(hours=1), NOW + timedelta(seconds=1))
    assert result["samples"] == 1
    assert len(result["values"]) == result["rows"] * result["columns"]
    assert max(result["values"]) == 1
    assert cell_of(result, 3, 4) > 0.95
    assert cell_of(result, 8, 6) == 0


def test_more_sightings_make_a_hotter_spot():
    busy = [point(NOW, 2, 2) for _ in range(5)]
    quiet = [point(NOW, 8, 6)]
    result = hm.build_heatmap(SITE, [incident(NOW, busy + quiet)], NOW - timedelta(hours=1), NOW + timedelta(seconds=1))
    assert cell_of(result, 2, 2) == pytest.approx(1, abs=0.02)
    assert 0.15 < cell_of(result, 8, 6) < 0.25


def test_only_sightings_inside_the_window_count():
    old = incident(NOW - timedelta(hours=3), [point(NOW - timedelta(hours=3), 2, 2)])
    recent = incident(NOW - timedelta(minutes=10), [point(NOW - timedelta(minutes=10), 8, 6)])
    one_hour = hm.build_heatmap(SITE, [old, recent], *hm.resolve_range("1h", None, None, NOW))
    day = hm.build_heatmap(SITE, [old, recent], *hm.resolve_range("24h", None, None, NOW))
    assert one_hour["samples"] == 1 and cell_of(one_hour, 2, 2) == 0
    assert day["samples"] == 2


def test_replay_sightings_end_at_recording_time_not_fixture_time():
    fixture_start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    replay = {"created_at": iso(NOW), "started_at": iso(fixture_start),
              "observations": [point(fixture_start, 4, 4), point(fixture_start + timedelta(seconds=30), 5, 5)]}
    # Recorded just now: every sighting falls inside the last hour, none in the future.
    result = hm.build_heatmap(SITE, [replay], *hm.resolve_range("1h", None, None, NOW))
    assert result["samples"] == 2
    assert all(hm.sample_time(replay, o) <= NOW for o in replay["observations"])


def test_live_incidents_use_their_real_observation_times():
    live = incident(NOW, [point(NOW - timedelta(hours=2), 4, 4)])
    live["evidence_mode"] = "live"
    assert hm.build_heatmap(SITE, [live], *hm.resolve_range("1h", None, None, NOW))["samples"] == 0
    assert hm.build_heatmap(SITE, [live], *hm.resolve_range("12h", None, None, NOW))["samples"] == 1


def motion(source: str, kind: str = "unknown") -> dict:
    return {"observed_at": iso(NOW), "source_id": source, "category": "motion", "location": {"kind": kind, "reason": "ring"}}


# Camera at (1, 4) looking along +x with a 110 degree view and 5 m reach.
FRONT = {"id": "front", "position_m": [1, 4, 2.2], "heading_degrees": 0, "fov_degrees": 110, "range_m": 5}
CAMERA_SITE = {**SITE, "layout": {**SITE["layout"], "cameras": [FRONT]}}


def test_events_from_cameras_off_the_map_are_reported_not_drawn():
    events = [motion("front"), motion("front", "room"),
              {**motion("hall"), "category": "coverage_gap"}]
    result = hm.build_heatmap(SITE, [incident(NOW, events)], NOW - timedelta(hours=1), NOW + timedelta(seconds=1))
    assert result["samples"] == 0 and result["estimated"] == 0 and result["values"] == []
    assert result["unpositioned"] == [{"camera_id": "front", "events": 2}]


def test_unpositioned_camera_events_are_estimated_across_its_view():
    result = hm.build_heatmap(CAMERA_SITE, [incident(NOW, [motion("front"), motion("front")])],
                              NOW - timedelta(hours=1), NOW + timedelta(seconds=1))
    assert result["samples"] == 0 and result["estimated"] == 2
    assert result["estimated_cameras"] == [{"camera_id": "front", "events": 2}] and result["unpositioned"] == []
    assert max(result["values"]) == 1
    assert cell_of(result, 3, 4) > 0.8          # straight ahead, inside the view
    assert cell_of(result, 3, 5.5) > 0.5        # off-axis but inside the wedge
    assert cell_of(result, 0.5, 4) == 0         # behind the camera
    assert cell_of(result, 1.5, 7.5) == 0       # outside the 110 degree wedge
    assert cell_of(result, 8.5, 4) == 0         # beyond its range


def test_positioned_sightings_outweigh_an_estimate():
    events = [motion("front"), point(NOW, 3, 4)]
    result = hm.build_heatmap(CAMERA_SITE, [incident(NOW, events)], NOW - timedelta(hours=1), NOW + timedelta(seconds=1))
    assert result["samples"] == 1 and result["estimated"] == 1
    assert cell_of(result, 3, 4) == pytest.approx(1, abs=0.05)
    assert 0.1 < cell_of(result, 4.5, 5) < 0.5


def test_uncertain_positions_spread_wider():
    sharp = hm.build_heatmap(SITE, [incident(NOW, [point(NOW, 5, 4, 0.2)])], NOW - timedelta(hours=1), NOW + timedelta(seconds=1))
    vague = hm.build_heatmap(SITE, [incident(NOW, [point(NOW, 5, 4, 1.8)])], NOW - timedelta(hours=1), NOW + timedelta(seconds=1))
    assert cell_of(vague, 6, 4) > cell_of(sharp, 6, 4)


def test_other_floors_and_off_map_points_are_ignored():
    stray = [point(NOW, 50, 50)]
    upstairs = [dict(point(NOW, 5, 5), location={**point(NOW, 5, 5)["location"], "floor_id": "floor_1"})]
    result = hm.build_heatmap(SITE, [incident(NOW, stray + upstairs)], NOW - timedelta(hours=1), NOW + timedelta(seconds=1))
    assert result["samples"] == 0


def test_range_validation():
    with pytest.raises(ValueError):
        hm.resolve_range("7d", None, None, NOW)
    with pytest.raises(ValueError):
        hm.resolve_range(None, iso(NOW), iso(NOW - timedelta(hours=1)), NOW)
    with pytest.raises(ValueError):
        hm.resolve_range(None, iso(NOW - timedelta(days=40)), iso(NOW), NOW)
    start, end = hm.resolve_range(None, iso(NOW - timedelta(hours=2)), iso(NOW), NOW)
    assert end - start == timedelta(hours=2)


def test_heatmap_endpoint_after_a_replay(setup):  # noqa: F811
    app, client, store, engine = setup
    empty = client.get("/v1/sites/site_demo/heatmap?window=1h")
    assert empty.status_code == 200 and empty.json()["samples"] == 0
    result = run(setup)
    incident_data = client.get("/v1/incidents/" + result["incident_id"]).json()
    positioned = sum(o["location"]["kind"] == "floor_point" for o in incident_data["observations"])
    for window in ("1h", "12h", "24h"):
        body = client.get(f"/v1/sites/site_demo/heatmap?window={window}").json()
        assert body["samples"] == positioned > 0
        assert max(body["values"]) == 1
    assert client.get("/v1/sites/site_demo/heatmap?window=7d").status_code == 422


def test_heatmap_is_private_to_the_site_owner(setup):  # noqa: F811
    app, client, store, engine = setup
    with store.connect() as db:
        db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)",
                   ("other", "other_owner", digest("other-token"), "Other", "android", time.time() + 1000))
    other = TestClient(app, headers={"Authorization": "Bearer other-token"})
    assert other.get("/v1/sites/site_demo/heatmap").status_code == 404
