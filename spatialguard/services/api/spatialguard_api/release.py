"""Server-owned release capabilities.

The certification profile is deliberately conservative.  Optional features can
be reviewed and enabled independently without creating a separate product fork.
"""
import os


def _enabled(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    return default if value is None else value.lower() in {"1", "true", "yes", "on"}


def capabilities() -> dict:
    profile = os.environ.get("SPATIALGUARD_RELEASE_PROFILE", "preview").lower()
    if profile not in {"preview", "reviewer", "certification"}:
        profile = "certification"
    conservative = profile == "certification"
    return {
        "profile": profile,
        "classification": _enabled("SPATIALGUARD_FEATURE_CLASSIFICATION", not conservative),
        "timelapse": _enabled("SPATIALGUARD_FEATURE_TIMELAPSE", not conservative),
        "uptime_history": _enabled("SPATIALGUARD_FEATURE_UPTIME_HISTORY", not conservative),
        "offline_alerts": _enabled("SPATIALGUARD_FEATURE_OFFLINE_ALERTS", not conservative),
        "test_video": _enabled("SPATIALGUARD_FEATURE_TEST_VIDEO", profile in {"preview", "reviewer"}),
        "synthetic_replay": _enabled("SPATIALGUARD_FEATURE_REPLAY", True),
        "reviewer_diagnostics": _enabled("SPATIALGUARD_FEATURE_REVIEWER_DIAGNOSTICS", profile == "reviewer"),
    }


def require_feature(name: str) -> None:
    from fastapi import HTTPException
    if not capabilities().get(name, False):
        raise HTTPException(404, "This feature is not available in this release")
