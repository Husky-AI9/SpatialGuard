import { useEffect, useMemo, useState } from "react";
import { Camera, History, MapPin, Plus, Radio, VideoOff } from "lucide-react";
import type { Camera as PlacedCamera } from "../../../../packages/sdk-typescript";
import CameraThumbnail from "./CameraThumbnail";
import CameraWall from "./CameraWall";
import { LiveVideo } from "./RingConnection";
import type { components } from "./generated";
import { request } from "./platform";
import RecoveryNotice from "./RecoveryNotice";

type Device = components["schemas"]["RingDevice"];
type RingStatus = components["schemas"]["RingStatus"];
type CameraStatus = components["schemas"]["CameraStatus"];
type Incident = components["schemas"]["Incident"];

type CameraSite = {
  id: string;
  layout: { cameras: PlacedCamera[] };
  monitoring: { enabled: boolean; camera_ids: string[] };
};

function stamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CameraWorkspace({
  site,
  initialCameraId,
  cameras,
  incidents,
  busy,
  online,
  onAdd,
  onToggle,
  onIncident,
  onSelectCamera,
}: {
  site: CameraSite | null;
  initialCameraId?: string;
  cameras: CameraStatus[];
  incidents: Incident[];
  busy: boolean;
  online: boolean;
  onAdd: () => void;
  onToggle: (cameraId: string, selected: boolean) => void;
  onIncident: (incident: Incident) => void;
  onSelectCamera: (cameraId: string) => void;
}) {
  const [ringState, setRingState] = useState("loading");
  const [mode, setMode] = useState<"Single camera" | "Camera wall">("Single camera");
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [liveDevice, setLiveDevice] = useState<Device | null>(null);
  const [ringError, setRingError] = useState("");

  useEffect(() => {
    let active = true;
    setRingError("");
    void request<RingStatus>("/v1/ring")
      .then(async (status) => {
        if (!active) return;
        setRingState(status.state);
        const next = status.state === "connected"
          ? await request<Device[]>("/v1/ring/devices")
          : [];
        if (active) setDevices(next);
      })
      .catch((error: Error) => {
        if (!active) return;
        setRingState("unavailable");
        setRingError(error.message || "Ring camera inventory is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [site?.id]);

  useEffect(() => {
    const ids = cameras.map((camera) => camera.id);
    setSelectedId((current) =>
      ids.includes(initialCameraId ?? "")
        ? initialCameraId!
        : ids.includes(current)
          ? current
          : (ids[0] ?? ""),
    );
  }, [site?.id, initialCameraId, cameras]);

  useEffect(() => {
    setLiveDevice(null);
  }, [site?.id]);

  const selected = cameras.find((camera) => camera.id === selectedId);
  const mappedDevice = (cameraId: string) =>
    devices.find(
      (device) => device.site_id === site?.id && device.camera_id === cameraId,
    );
  const selectedIncidents = useMemo(() => {
    if (!selectedId) return incidents;
    return incidents.filter((incident) =>
      incident.observations.some((observation) => observation.source_id === selectedId),
    );
  }, [incidents, selectedId]);

  const openCamera = (camera: CameraStatus) => {
    setSelectedId(camera.id);
    onSelectCamera(camera.id);
    setLiveDevice(mappedDevice(camera.id) ?? null);
  };

  return (
    <section className="camera-page" aria-label="Camera monitoring workspace">
      <div className="cctv-toolbar">
        <div>
          <h2>Cameras</h2>
          <p>
            {ringState === "connected"
              ? "Ring connected. Select a mapped camera to start a bounded live view."
              : "Live Ring video is unavailable. Replay cameras remain visible for testing."}
          </p>
        </div>
        <div className="cctv-toolbar-actions">
          <div className="view-toggle" aria-label="Camera view">
            {(["Single camera", "Camera wall"] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value}</button>)}
          </div>
          {mode === "Single camera" && <button
            disabled={!site || busy || !online || site.layout.cameras.length >= 8}
            onClick={onAdd}
          >
            <Plus size={16} />
            Add camera
          </button>}
        </div>
      </div>

      {mode === "Camera wall" ? <CameraWall /> : <div className="cctv-workspace">
        <div className="cctv-main">
          <section className="cctv-display" aria-label="Camera feed">
            <header>
              <div>
                <span className="eyebrow">Camera feed</span>
                <h3>{selected?.name ?? "No camera selected"}</h3>
              </div>
              {liveDevice && (
                <span className="live-indicator"><Radio size={13} /> Live</span>
              )}
            </header>
            <div className="cctv-stage">
              {liveDevice ? (
                <LiveVideo
                  key={liveDevice.id}
                  device={liveDevice}
                  embedded
                  close={() => setLiveDevice(null)}
                />
              ) : (
                <div className="cctv-empty">
                  {selected ? <VideoOff size={34} /> : <Camera size={34} />}
                  <strong>
                    {selected
                      ? mappedDevice(selected.id)
                        ? "Live view is stopped"
                        : "Replay camera"
                      : "Choose a camera"}
                  </strong>
                  <span>
                    {selected
                      ? mappedDevice(selected.id)
                        ? "Select this camera again to request a new live session."
                        : "No Ring live feed is mapped to this floor-plan camera."
                      : "Camera feeds open here without leaving this page."}
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="cctv-incidents" aria-label="Incident report">
            <header>
              <div>
                <span className="eyebrow">Incident report</span>
                <h3>{selected ? selected.name : "All cameras"}</h3>
              </div>
              <span>{selectedIncidents.length}</span>
            </header>
            <div className="cctv-incident-scroll">
              {selectedIncidents.length ? (
                selectedIncidents.map((incident) => (
                  <button
                    className="cctv-incident-row"
                    key={incident.id}
                    onClick={() => onIncident(incident)}
                  >
                    <MapPin size={16} />
                    <span>
                      <strong>{incident.title}</strong>
                      <small>
                        {stamp(incident.created_at)} · {incident.status === "reviewed" ? "Reviewed" : "Needs review"}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="cctv-no-incidents">
                  <History size={20} />
                  <span>No incident reports for this camera.</span>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="cctv-sidebar" aria-label="Camera feed list">
          <header>
            <div>
              <h3>CCTVs</h3>
              <span>{cameras.length} devices</span>
            </div>
            <span className={ringState === "connected" ? "provider-up" : "provider-down"}>
              {ringState === "connected" ? "Ring connected" : "Replay"}
            </span>
          </header>
          {ringError && <RecoveryNotice message={ringError} />}
          <div className="cctv-camera-scroll">
            {cameras.map((camera) => {
              const ring = mappedDevice(camera.id);
              const included = !!site?.monitoring.camera_ids.includes(camera.id);
              return (
                <article
                  className={`cctv-camera-row${selectedId === camera.id ? " selected" : ""}`}
                  key={camera.id}
                >
                  <button
                    className="cctv-camera-select"
                    aria-label={`View ${camera.name}`}
                    aria-pressed={selectedId === camera.id}
                    onClick={() => openCamera(camera)}
                  >
                    <CameraThumbnail
                      className="cctv-thumb"
                      siteId={site?.id}
                      cameraId={camera.id}
                      name={camera.name}
                      available={!!ring}
                    />
                    <span>
                      <strong>{camera.name}</strong>
                      <small>{ring ? "Ring camera" : "Floor-plan camera"}</small>
                      <em>{ring ? "● Live available" : "Replay only"}</em>
                    </span>
                  </button>
                  <label className="monitor-switch" title="Include in monitoring">
                    <input
                      type="checkbox"
                      aria-label={`Monitor ${camera.name}`}
                      checked={included}
                      disabled={busy || !online}
                      onChange={(event) => onToggle(camera.id, event.target.checked)}
                    />
                    <span />
                  </label>
                </article>
              );
            })}
            {!cameras.length && (
              <div className="cctv-no-cameras">
                <Camera size={22} />
                <p>Add a floor-plan camera to begin.</p>
              </div>
            )}
          </div>
        </aside>
      </div>}
    </section>
  );
}
