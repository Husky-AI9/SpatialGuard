from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from twinforge.models import Coordinate, Layout, Observation


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Monitoring(Model):
    enabled: bool
    camera_ids: list[str] = Field(max_length=8)
    classification_enabled: bool = False


class Site(Model):
    id: str
    name: str
    revision_id: str
    layout: Layout
    monitoring: Monitoring
    monitoring_version: int = 0
    evidence_mode: Literal["replay"] = "replay"
    ring_status: Literal["not_connected"] = "not_connected"


Height = Annotated[float, Field(ge=-100, le=100)]


class CameraInput(Model):
    """Owner-placed camera. Identity, lens, calibration hash, and provenance stay server-assigned."""

    name: str = Field(default="New camera", min_length=1, max_length=100)
    position_m: tuple[Coordinate, Coordinate, Height]
    heading_degrees: float = Field(default=0, ge=-360, le=360)
    pitch_degrees: float = Field(default=0, ge=-89, le=89)
    range_m: float = Field(default=4, gt=0, le=100)


class CameraEdit(Model):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    position_m: tuple[Coordinate, Coordinate, Height] | None = None
    heading_degrees: float | None = Field(default=None, ge=-360, le=360)
    pitch_degrees: float | None = Field(default=None, ge=-89, le=89)
    range_m: float | None = Field(default=None, gt=0, le=100)


class CameraStatus(Model):
    id: str
    name: str
    selected: bool
    state: Literal["replay_only", "unavailable", "live_connected"] = "replay_only"
    last_observed_at: str | None = None
    calibration: str = "Synthetic coordinates; no real-camera calibration"


class PlanInput(Model):
    """An owner-supplied floor-plan drawing to trace into a map."""

    name: str = Field(min_length=1, max_length=100)
    media_type: Literal["image/png", "image/jpeg"]
    data_base64: str = Field(max_length=8_000_000)
    ceiling_height_m: float = Field(default=2.6, gt=0, le=20)
    # Opt-in: sends this drawing to OpenAI from the TwinForge server.
    vision_assisted: bool = False


class PlanJob(Model):
    job_id: str
    name: str
    state: Literal["queued", "running", "needs_review", "succeeded", "failed", "cancelled"]
    # Traced geometry stays a draft until the owner accepts it, so the layout is a preview.
    layout: Layout | None = None
    rooms: int = 0
    connections: int = 0
    # What the drawing implies before the owner measures anything.
    traced_width_m: float = 0
    traced_depth_m: float = 0
    scale_basis: str | None = None
    label_reader: str | None = None
    warning: str | None = None
    error: str | None = None
    # "completed" when GPT Sol produced the geometry, "failed" when TwinForge fell
    # back to local tracing, None when vision was never requested.
    vision_status: Literal["completed", "failed"] | None = None
    vision_error: str | None = None


class Preferences(Model):
    """Which place the owner last looked at, so a reload reopens it."""

    active_site_id: str | None = None


class RoomEdit(Model):
    """Owners name their own spaces; tracing only ever guesses."""

    name: str = Field(min_length=1, max_length=100)


class GenerationOptions(Model):
    vision_available: bool


class PlanAccept(Model):
    """Two owner-measured dimensions. Tracing cannot establish real metres on its own."""

    width_m: float = Field(gt=0, le=1000)
    depth_m: float = Field(gt=0, le=1000)


class Association(Model):
    from_observation_id: str
    to_observation_id: str
    state: Literal["possible"] = "possible"
    reason: str
    unobserved_gap_seconds: float


ClassificationLabel = Literal[
    "delivery_activity",
    "face_covering_visible",
    "possible_weapon_visible",
    "possible_unauthorized_entry",
    "unidentified_person",
    "package_visible",
    "animal_visible",
    "vehicle_visible",
    "unclear",
    "no_relevant_activity",
]


class IncidentClassification(Model):
    label: ClassificationLabel
    display_label: str = Field(min_length=1, max_length=80)
    confidence: Literal["low", "medium", "high"]
    summary: str = Field(min_length=1, max_length=300)
    visible_evidence: list[str] = Field(max_length=5)
    uncertainty: str = Field(min_length=1, max_length=300)
    model: str = Field(min_length=1, max_length=100)
    response_id: str | None = Field(default=None, max_length=200)
    analyzed_at: str


class Incident(Model):
    id: str
    site_id: str
    revision_id: str
    calibration_ids: list[str] = []
    run_id: str
    status: Literal["needs_review", "reviewed"] = "needs_review"
    title: str
    rule: str
    started_at: str
    created_at: str
    evidence_mode: Literal["replay", "live", "simulator"] = "replay"
    observations: list[Observation]
    associations: list[Association]
    evidence_ids: list[str]
    classification_status: Literal["not_requested", "completed", "unavailable"] = "not_requested"
    classification: IncidentClassification | None = None
    reviewed_at: str | None = None


class ClassifierStatus(Model):
    configured: bool
    model: str


class TestVideo(Model):
    id: str
    name: str
    lighting: Literal["day", "night"]
    duration_seconds: float
    classification_frame_seconds: float


class TestTrackPoint(Model):
    t_seconds: float = Field(ge=0)
    foot_x_norm: float = Field(ge=0, le=1)
    foot_y_norm: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)


class TestVideoTrack(Model):
    video_id: str
    detector: str
    points: list[TestTrackPoint]


class EvidenceAsset(Model):
    id: str
    incident_id: str
    observation_id: str
    mode: Literal["replay"] = "replay"
    media_type: Literal["image/svg+xml"] = "image/svg+xml"
    description: str


class MediaSession(Model):
    id: str
    camera_id: str
    state: Literal["denied"] = "denied"
    reason: str = "Ring is not connected. Replay has no live media session."


class ReplayInput(Model):
    request_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{8,80}$")


class ReplayRun(Model):
    id: str
    state: Literal["queued", "running", "succeeded", "paused", "failed"]
    incident_id: str | None = None
    error: str | None = None


class PairInput(Model):
    code: str = Field(min_length=12, max_length=32)
    name: str = Field(default="Android device", min_length=1, max_length=60)


class AccountCredentials(Model):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str):
        from .auth import normalize_email
        return normalize_email(value)


class AccountPreferences(Model):
    onboarding_completed: bool = False
    ring_data_consent: bool = False
    classification_consent: bool = False
    incident_retention_days: Literal[30, 90, 365] = 90
    audit_retention_days: Literal[90, 365, 730] = 365
    consent_updated_at: str | None = None


class AccountDeletion(Model):
    password: str = Field(min_length=8, max_length=128)
    confirmation: Literal["DELETE"]


class PasswordRequest(Model):
    email: str = Field(min_length=3, max_length=254)


class PasswordReset(Model):
    token: str = Field(min_length=24, max_length=300)
    password: str = Field(min_length=8, max_length=128)


class TokenConfirmation(Model):
    token: str = Field(min_length=24, max_length=300)


class PasswordChange(Model):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthMessage(Model):
    message: str


class AccessRecord(Model):
    id: int
    actor: str
    action: str
    device: str
    purpose: str
    result: str
    at: str


class NotificationPreferences(Model):
    incident_email: bool = True
    operational_email: bool = True
    weekly_summary: bool = False
    marketing: bool = False


class ProductCapabilities(Model):
    profile: Literal["preview", "reviewer", "certification"]
    classification: bool
    timelapse: bool
    uptime_history: bool
    offline_alerts: bool
    test_video: bool
    synthetic_replay: bool
    reviewer_diagnostics: bool


class DeletionReceipt(Model):
    reference: str
    requested_at: str
    completed_at: str
    categories: list[str]
    downstream: str


class PairCode(Model):
    code: str
    expires_at: float


class Session(Model):
    id: str
    name: str
    kind: Literal["browser", "android", "ios"]
    expires_at: float
    email: str | None = None


class SessionToken(Model):
    token: str
    session: Session


class AuthSession(Model):
    session: Session
    token: str | None = None


class ReviewInput(Model):
    status: Literal["reviewed"] = "reviewed"


class Event(Model):
    sequence: int
    kind: str
    resource_id: str


class EventPage(Model):
    events: list[Event]
    cursor: int


class HeatmapUnpositioned(Model):
    camera_id: str
    events: int


class Heatmap(Model):
    """Normalised people density on a site grid; row-major from the minimum y."""

    site_id: str
    since: str
    until: str
    samples: int
    # Camera events whose recording showed where the person walked (projected path).
    tracked: int = 0
    # Camera events with no analyzed recording yet: one estimated dot each.
    estimated: int = 0
    estimated_cameras: list[HeatmapUnpositioned] = []
    cell_m: float
    origin_xy_m: tuple[float, float]
    columns: int
    rows: int
    values: list[float]
    unpositioned: list[HeatmapUnpositioned]


class AnalyticsPeriod(Model):
    since: str
    until: str
    previous_since: str
    days: int


class AnalyticsTotals(Model):
    visits: int
    previous: int
    change_pct: float | None
    avg_visit_s: float | None
    avg_visit_previous_s: float | None
    peak_hour: int | None
    peak_hour_visits: int
    busiest_zone: str | None
    quietest_zone: str | None
    first_hour: int | None
    last_hour: int | None


class AnalyticsDay(Model):
    date: str
    visits: int
    previous: int


class AnalyticsHour(Model):
    hour: int
    visits: int
    previous: int


class AnalyticsZone(Model):
    name: str
    visits: int
    previous: int
    dwell_s: float | None
    dwell_previous_s: float | None


class AnalyticsEntrance(Model):
    camera_id: str
    name: str
    visits: int
    previous: int


class AnalyticsQuality(Model):
    tracked: int
    positioned: int
    estimated: int


class SiteAnalytics(Model):
    """Foot traffic for one site: the last 7 local days against the 7 before."""

    site_id: str
    site_name: str
    time_zone: str
    generated_at: str
    period: AnalyticsPeriod
    totals: AnalyticsTotals
    daily: list[AnalyticsDay]
    hourly: list[AnalyticsHour]
    week_grid: list[list[int]]
    # The previous period's grid, aligned by weekday with week_grid.
    week_grid_previous: list[list[int]] = []
    zones: list[AnalyticsZone]
    entrances: list[AnalyticsEntrance]
    quality: AnalyticsQuality
    layout_changes: list[str]


class SiteAnalyticsSummary(Model):
    site_id: str
    name: str
    visits: int
    previous: int
    change_pct: float | None
    peak_hour: int | None
    busiest_zone: str | None


class InsightHighlight(Model):
    title: str
    detail: str
    trend: Literal["up", "down", "flat", "info"]


class SiteInsight(Model):
    """A weekly AI summary written by Amazon Bedrock from aggregate numbers only."""

    headline: str
    summary: str
    highlights: list[InsightHighlight]
    recommendation: str
    model: str
    provider: str
    generated_at: str
    period_until: str
    visits: int


class SiteInsightState(Model):
    available: bool
    provider: str
    model: str
    insight: SiteInsight | None = None
    # No insight yet, or the latest is over a week old.
    stale: bool = True


class InsightRequest(Model):
    tz: str | None = Field(default=None, max_length=64)


class CrowdAlertZone(Model):
    name: str
    kind: Literal["queue", "crowding"]
    # Distinct visitors within the window that raise an alert; null turns the zone off.
    limit: int | None


class CrowdAlertSettings(Model):
    enabled: bool
    window_minutes: int
    zones: list[CrowdAlertZone]


class CrowdAlertSettingsInput(Model):
    enabled: bool = True
    window_minutes: int = Field(default=5, ge=1, le=60)
    limits: dict[str, Annotated[int, Field(ge=1, le=50)] | None] = Field(default_factory=dict, max_length=200)


class CrowdAlert(Model):
    id: int
    zone: str
    kind: Literal["queue", "crowding"]
    count: int
    limit: int
    window_minutes: int
    at: str
    acknowledged: bool


class CrowdLiveZone(Model):
    name: str
    kind: Literal["queue", "crowding"]
    count: int
    limit: int | None


class CrowdAlerts(Model):
    settings: CrowdAlertSettings
    alerts: list[CrowdAlert]
    live: list[CrowdLiveZone]


class IncidentPage(Model):
    incidents: list[Incident]
    next_cursor: int | None = None
