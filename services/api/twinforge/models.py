from datetime import datetime, timezone
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import math


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


Coordinate = Annotated[float, Field(ge=-10000, le=10000)]
Point = tuple[Coordinate, Coordinate]
Identifier = Annotated[
    str, Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
]


class Provenance(Model):
    kind: Literal["measured", "manual", "inferred", "unknown"]
    source_ids: list[Identifier] = Field(default_factory=list, max_length=100)
    confirmed: bool = False
    explanation: str = Field(min_length=1, max_length=1000)


class Floor(Model):
    id: Identifier
    name: str = Field(min_length=1, max_length=100)
    elevation_m: float = 0


class Room(Model):
    id: Identifier
    floor_id: Identifier
    name: str = Field(min_length=1, max_length=100)
    polygon_xy_m: list[Point] = Field(min_length=3, max_length=200)
    height_m: float = Field(default=2.6, gt=0, le=20)
    provenance: Provenance


class Zone(Model):
    id: Identifier
    floor_id: Identifier
    name: str = Field(min_length=1, max_length=100)
    purpose: str = Field(default="general", max_length=100)
    polygon_xy_m: list[Point] = Field(min_length=3, max_length=200)
    provenance: Provenance


class Portal(Model):
    id: Identifier
    name: str = Field(min_length=1, max_length=100)
    from_room_id: Identifier
    to_room_id: Identifier
    segment_xy_m: tuple[Point, Point]
    width_m: float = Field(gt=0, le=20)
    state: Literal["open", "closed", "unknown"] = "unknown"
    state_observed_at: datetime | None = None
    provenance: Provenance

    @field_validator("state_observed_at")
    @classmethod
    def aware(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("Timestamp requires timezone")
        return v.astimezone(timezone.utc) if v else None


class Camera(Model):
    id: Identifier
    name: str = Field(min_length=1, max_length=100)
    floor_id: Identifier
    position_m: tuple[Coordinate, Coordinate, Annotated[float, Field(ge=-100, le=100)]]
    heading_degrees: float = 0
    pitch_degrees: float = Field(default=0, ge=-89, le=89)
    fov_degrees: float = Field(default=70, gt=0, lt=180)
    range_m: float = Field(default=4, gt=0, le=100)
    configuration_hash: str = Field(min_length=1, max_length=200)
    provenance: Provenance


class ScaleAnchor(Model):
    points: tuple[Point, Point]
    distance_m: float = Field(gt=0, le=1000)
    source: str = Field(min_length=1, max_length=300)


class FloorPlanImage(Model):
    asset_id: Identifier
    origin_xy_m: Point = (0, 0)
    width_m: float = Field(gt=0, le=10000)
    height_m: float = Field(gt=0, le=10000)


class Layout(Model):
    schema_version: Literal["0.1"] = "0.1"
    units: Literal["meters"] = "meters"
    world_frame: Literal["RH_Xright_Yforward_Zup"] = "RH_Xright_Yforward_Zup"
    scale_status: Literal["unknown", "verified"] = "unknown"
    scale_anchors: list[ScaleAnchor] = Field(default_factory=list, max_length=10)
    floors: list[Floor] = Field(min_length=1, max_length=1)
    rooms: list[Room] = Field(default_factory=list, max_length=30)
    zones: list[Zone] = Field(default_factory=list, max_length=30)
    portals: list[Portal] = Field(default_factory=list, max_length=60)
    cameras: list[Camera] = Field(default_factory=list, max_length=8)
    asset_ids: list[Identifier] = Field(default_factory=list, max_length=30)
    floor_plan: FloorPlanImage | None = None


class SiteInput(Model):
    name: str = Field(min_length=1, max_length=100)


class LocalExample(Model):
    """Locally provisioned, tenant-private example; never a remote URL import."""

    id: Identifier
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=1000)
    layout: Layout


class DraftInput(Model):
    parent_revision_id: Identifier | None = None
    layout: Layout | None = None


class PointLocation(Model):
    kind: Literal["floor_point"]
    floor_id: Identifier
    xy_m: Point
    uncertainty_radius_m: float = Field(ge=0, le=1000)
    calibration_id: Identifier | None = None


class RoomLocation(Model):
    kind: Literal["room"]
    room_id: Identifier
    reason: str = Field(min_length=1, max_length=1000)


class UnknownLocation(Model):
    kind: Literal["unknown"]
    reason: str = Field(min_length=1, max_length=1000)


class Evidence(Model):
    mode: Literal["replay", "live", "simulator"]
    asset_id: Identifier | None = None


class Observation(Model):
    schema_version: Literal["0.1"] = "0.1"
    observation_id: Identifier
    site_id: Identifier
    revision_id: Identifier
    source_id: Identifier
    observed_at: datetime
    received_at: datetime
    category: str = Field(min_length=1, max_length=100)
    location: Annotated[
        PointLocation | RoomLocation | UnknownLocation, Field(discriminator="kind")
    ]
    evidence: Evidence
    provenance: Provenance

    @field_validator("observed_at", "received_at")
    @classmethod
    def timestamp(cls, v):
        if v.tzinfo is None:
            raise ValueError("Timestamp requires a UTC offset")
        v = v.astimezone(timezone.utc)
        if v.year < 2000 or (v - datetime.now(timezone.utc)).total_seconds() > 300:
            raise ValueError("Timestamp outside supported range")
        return v


class ObservationBatch(Model):
    observations: list[Observation] = Field(min_length=1, max_length=500)


class Assumptions(Model):
    unknown_portals: Literal["exclude", "include"] = "exclude"
    minimum_clearance_m: float = Field(default=0.8, ge=0, le=20)
    maximum_state_age_seconds: int = Field(default=30, ge=0, le=31536000)
    at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("at")
    @classmethod
    def aware(cls, v):
        if v.tzinfo is None:
            raise ValueError("Query time requires a timezone")
        return v.astimezone(timezone.utc)


class PointQuery(Model):
    kind: Literal["room", "zone", "visibility"]
    floor_id: Identifier
    xy_m: Point
    uncertainty_radius_m: float = Field(default=0, ge=0, le=1000)


class GraphQuery(Model):
    kind: Literal["adjacency", "path"]
    from_room_id: Identifier
    to_room_id: Identifier | None = None
    assumptions: Assumptions = Field(default_factory=Assumptions)


Query = Annotated[PointQuery | GraphQuery, Field(discriminator="kind")]


class Correspondence(Model):
    image_xy: Point
    floor_xy_m: Point


class CalibrationInput(Model):
    camera_id: Identifier
    configuration_hash: str = Field(min_length=1, max_length=200)
    resolution: tuple[
        Annotated[int, Field(gt=0, le=16000)], Annotated[int, Field(gt=0, le=16000)]
    ]
    image_space: Literal["undistorted"] = "undistorted"
    image_points: list[Correspondence] = Field(min_length=4, max_length=100)
    holdout_points: list[Correspondence] = Field(min_length=3, max_length=100)
    reviewed: bool


class ProjectionInput(Model):
    image_xy: Point
    configuration_hash: str
    resolution: tuple[int, int]


class ImportInput(Model):
    kind: Literal["bundle", "photo_reconstruction", "floorplan_raster"]
    bundle: dict | None = None
    # A raster trace reads a plan image that is already stored in this site.
    asset_id: Identifier | None = None
    ceiling_height_m: float = Field(default=2.6, gt=0, le=20)
    vision_assisted: bool = False

    @model_validator(mode="after")
    def inputs_match_kind(self):
        if self.kind == "bundle" and not self.bundle:
            raise ValueError("A bundle import requires bundle contents")
        if self.kind == "floorplan_raster" and not self.asset_id:
            raise ValueError("A plan trace requires the uploaded image asset_id")
        if self.kind != "bundle" and self.bundle:
            raise ValueError("Bundle contents belong to a bundle import")
        if self.vision_assisted and self.kind != "floorplan_raster":
            raise ValueError("Vision assistance requires a floor-plan image import")
        return self


class AssetInput(Model):
    name: str = Field(min_length=1, max_length=150)
    media_type: Literal["image/png", "image/jpeg"]
    data_base64: str = Field(max_length=8_000_000)
    consent: Literal["synthetic", "owner_approved", "publicly_licensed"]
    license: str = Field(min_length=1, max_length=300)
