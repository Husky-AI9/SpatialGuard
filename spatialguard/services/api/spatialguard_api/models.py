from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field
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


class PairCode(Model):
    code: str
    expires_at: float


class Session(Model):
    id: str
    name: str
    kind: Literal["browser", "android"]
    expires_at: float


class SessionToken(Model):
    token: str
    session: Session


class ReviewInput(Model):
    status: Literal["reviewed"] = "reviewed"


class Event(Model):
    sequence: int
    kind: str
    resource_id: str


class EventPage(Model):
    events: list[Event]
    cursor: int


class IncidentPage(Model):
    incidents: list[Incident]
    next_cursor: int | None = None
