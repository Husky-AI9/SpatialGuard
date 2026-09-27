import { useEffect, useState } from "react";
import { Radio, Trash2, VideoOff } from "lucide-react";
import type { Camera as PlacedCamera } from "../../../../packages/sdk-typescript";
import CameraThumbnail from "./CameraThumbnail";
import CameraWall from "./CameraWall";
import { LiveVideo } from "./RingConnection";
import type { components } from "./generated";
import { request } from "./platform";
import RecoveryNotice from "./RecoveryNotice";
import CameraMark from "./CameraMark";

type Device = components["schemas"]["RingDevice"];
type RingStatus = components["schemas"]["RingStatus"];
type CameraStatus = components["schemas"]["CameraStatus"];
type CameraSite = {
  id: string;
  layout: { cameras: PlacedCamera[] };
  monitoring: { enabled: boolean; camera_ids: string[] };
};

export default function CameraWorkspace({
  site, initialCameraId, cameras, busy, online, onToggle, onSelectCamera, onPairCamera, onRemoveCamera, ringVersion = 0,
}: {
  site: CameraSite | null;
  initialCameraId?: string;
  cameras: CameraStatus[];
  busy: boolean;
  online: boolean;
  onToggle: (cameraId: string, selected: boolean) => void;
  onSelectCamera: (cameraId: string) => void;
  onPairCamera: (camera: { id: string; name: string }) => void;
  ringVersion?: number;
  onRemoveCamera?: (camera: { id: string; name: string }) => void;
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
        const next = status.state === "connected" ? await request<Device[]>("/v1/ring/devices") : [];
        if (active) setDevices(next);
      })
      .catch((error: Error) => {
        if (!active) return;
        setRingState("unavailable");
        setRingError(error.message || "Ring camera inventory is unavailable.");
      });
    return () => { active = false; };
  }, [site?.id, ringVersion]);

  useEffect(() => {
    const ids = cameras.map((camera) => camera.id);
    setSelectedId((current) => ids.includes(initialCameraId ?? "") ? initialCameraId!
      : ids.includes(current) ? current : (ids[0] ?? ""));
  }, [site?.id, initialCameraId, cameras]);

  useEffect(() => { setLiveDevice(null); }, [site?.id]);
  const selected = cameras.find((camera) => camera.id === selectedId);
  const mappedDevice = (cameraId: string) => devices.find(
    (device) => device.site_id === site?.id && device.camera_id === cameraId,
  );
  const openCamera = (camera: CameraStatus) => {
    setSelectedId(camera.id);
    onSelectCamera(camera.id);
    setLiveDevice(mappedDevice(camera.id) ?? null);
  };

  return (
    <section className="camera-page" aria-label="Camera monitoring workspace">
      <div className="cctv-toolbar">
        <div className="view-toggle" aria-label="Camera view">
          {(["Single camera", "Camera wall"] as const).map(value => (
            <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value}</button>
          ))}
        </div>
      </div>
      {mode === "Camera wall" ? <CameraWall /> : (
        <div className="cctv-workspace camera-feed-workspace">
          <section className="cctv-display" aria-label="Camera feed">
            <header>
              <div>
                <h3>{selected?.name ?? "No camera selected"}</h3>
                <span className="cctv-display-sub">{liveDevice ? "Ring live view" : selected && mappedDevice(selected.id) ? "Ring camera" : "Not paired"}</span>
              </div>
              {liveDevice && <span className="live-indicator"><Radio size={13} /> Live</span>}
            </header>
            <div className="cctv-stage">
              {liveDevice ? (
                <LiveVideo key={liveDevice.id} device={liveDevice} embedded close={() => setLiveDevice(null)} />
              ) : (
                <div className="cctv-empty">
                  {selected ? <VideoOff size={34} /> : <CameraMark size={34} />}
                  <strong>{selected ? (mappedDevice(selected.id) ? "Live view is stopped" : "Camera is not paired") : "Choose a camera"}</strong>
                  <span>{selected && !mappedDevice(selected.id) ? "Pair it with a Ring camera to watch it here." : "Select a camera from the CCTV list."}</span>
                  {selected && !mappedDevice(selected.id) && <button className="primary" onClick={() => onPairCamera(selected)}>Pair Ring camera</button>}
                </div>
              )}
            </div>
          </section>
          <aside className="cctv-sidebar" aria-label="Camera feed list">
            <header>
              <div><h3>CCTVs</h3><span>{cameras.length} devices</span></div>
              <span className={ringState === "connected" ? "provider-up" : "provider-down"}>{ringState === "connected" ? "Ring connected" : "Ring not linked"}</span>
            </header>
            {ringError && <RecoveryNotice message={ringError} />}
            <div className="cctv-camera-scroll">
              {cameras.map((camera) => {
                const ring = mappedDevice(camera.id);
                const included = !!site?.monitoring.camera_ids.includes(camera.id);
                return (
                  <article className={`cctv-camera-row${selectedId === camera.id ? " selected" : ""}`} key={camera.id}>
                    <button className="cctv-camera-select" aria-label={`View ${camera.name}`} aria-pressed={selectedId === camera.id} onClick={() => openCamera(camera)}>
                      <CameraThumbnail className="cctv-thumb" siteId={site?.id} cameraId={camera.id} name={camera.name} available={!!ring} />
                      <span><strong>{camera.name}</strong><small>{ring ? "Ring camera" : "Floor-plan camera"}</small><em>{ring ? "● Live available" : "Not paired"}</em></span>
                    </button>
                    {!ring && ringState !== "loading" && <button className="pair-camera-button" onClick={() => onPairCamera(camera)}>Pair</button>}
                    {onRemoveCamera && <button className="camera-remove" aria-label={`Remove ${camera.name}`} title="Remove camera" disabled={busy} onClick={() => onRemoveCamera(camera)}><Trash2 size={16} /></button>}
                    <label className="monitor-switch" title="Include in monitoring">
                      <em>Monitor</em>
                      <input type="checkbox" aria-label={`Monitor ${camera.name}`} checked={included} disabled={busy || !online} onChange={(event) => onToggle(camera.id, event.target.checked)} />
                      <span />
                    </label>
                  </article>
                );
              })}
              {!cameras.length && <div className="cctv-no-cameras"><CameraMark size={22} /><p>Add cameras from your floor plan first.</p></div>}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
