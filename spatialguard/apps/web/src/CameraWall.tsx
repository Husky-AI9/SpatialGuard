import { useEffect, useMemo, useState } from "react";
import { GripVertical, RefreshCw, Video } from "lucide-react";
import { LiveVideo } from "./RingConnection";
import { request } from "./platform";
import RecoveryNotice from "./RecoveryNotice";
import CameraMark from "./CameraMark";

type WallDevice = {
  id: string;
  name: string;
  online: boolean;
  status: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  checked_at: string;
  site_id: string | null;
  camera_id: string | null;
};

type MotionEvent = {
  id: string;
  title: string;
  started_at: string;
  site_id: string;
  cameras: string[];
  clip_available: boolean;
};

type WallData = {
  devices: WallDevice[];
  wall: string[];
  motion_events: MotionEvent[];
};

export default function CameraWall({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<WallData>({ devices: [], wall: [], motion_events: [] });
  const [wall, setWall] = useState<string[]>([]);
  const [dragging, setDragging] = useState("");
  const [active, setActive] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (refresh = false) => {
    setError("");
    setLoading(true);
    try {
      if (refresh) await request("/v1/ring/devices/refresh", "POST");
      const result = await request<WallData>("/v1/ring/operations");
      setData(result);
      setWall(result.wall);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Camera wall unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void request<WallData>("/v1/ring/operations").then(result => {
        setData(result);
        setWall(current => current.length ? current : result.wall);
      }).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const wallDevices = useMemo(
    () => wall.map(id => data.devices.find(device => device.id === id)).filter(Boolean) as WallDevice[],
    [wall, data.devices],
  );

  const saveWall = async (next: string[]) => {
    setWall(next);
    try {
      await request("/v1/ring/operations/wall", "PUT", { devices: next });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save camera order");
      void load();
    }
  };

  const moveCamera = (deviceId: string, direction: -1 | 1) => {
    const index = wall.indexOf(deviceId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= wall.length) return;
    const next = [...wall];
    [next[index], next[destination]] = [next[destination], next[index]];
    void saveWall(next);
  };

  return <section className={`camera-wall-view${compact ? " compact" : ""}`} aria-label="Live camera wall">
    <div className="camera-wall-heading">
      <div>
        <span className="eyebrow">Live cameras</span>
        <h3>Camera wall</h3>
        {!compact && <p>Up to 16 cameras. One live view at a time.</p>}
      </div>
      <div className="camera-wall-heading-actions">
        <span>{wall.length}/16</span>
        <button aria-label="Refresh camera wall" disabled={loading} onClick={() => void load(true)}><RefreshCw size={15} /></button>
      </div>
    </div>
    {error && <RecoveryNotice message={error} onRetry={() => void load()} />}
    <div className="wall-picker" aria-label="Cameras shown on wall">
      {data.devices.map(device => <label key={device.id}>
        <input type="checkbox" checked={wall.includes(device.id)} disabled={!wall.includes(device.id) && wall.length >= 16} onChange={event => void saveWall(event.target.checked ? [...wall, device.id] : wall.filter(id => id !== device.id))} />
        {device.name}
      </label>)}
    </div>
    <div className="camera-wall-grid">
      {wallDevices.map((device, index) => <article key={device.id} role="group" aria-label={`${device.name} camera tile`} draggable onDragStart={() => setDragging(device.id)} onDragOver={event => event.preventDefault()} onDrop={() => {
        if (!dragging || dragging === device.id) return;
        const next = wall.filter(id => id !== dragging);
        next.splice(next.indexOf(device.id), 0, dragging);
        setDragging("");
        void saveWall(next);
      }} className="camera-wall-tile">
        <div className="wall-tile-head">
          <GripVertical size={16} aria-hidden="true" />
          <span className={device.online ? "online" : "offline"}>{device.online ? "Online" : "Offline"}</span>
          <span className="wall-order-actions">
            <button aria-label={`Move ${device.name} earlier`} disabled={index === 0} onClick={() => moveCamera(device.id, -1)}>Up</button>
            <button aria-label={`Move ${device.name} later`} disabled={index === wallDevices.length - 1} onClick={() => moveCamera(device.id, 1)}>Down</button>
          </span>
        </div>
        {active !== device.id
          ? <div className="wall-paused"><CameraMark size={24} /><p>{active ? "Another camera is active" : "Live view closed"}</p><button disabled={!device.online} onClick={() => setActive(device.id)}>{device.online ? "Start live view" : "Camera offline"}</button></div>
          : <LiveVideo device={device as never} embedded autoReconnect={false} close={() => setActive("")} />}
      </article>)}
    </div>
    {!wall.length && <div className="operations-empty"><Video size={25} /><h3>Your camera wall is empty</h3><p>Select up to 16 authorized Ring cameras.</p></div>}
    {!compact && <div className="motion-history"><h3>Motion history</h3><p>Open an incident to watch its recordings.</p>
      <div className="motion-event-list">{data.motion_events.length ? data.motion_events.map(event => <article key={event.id}><span><strong>{event.title}</strong><small>{new Date(event.started_at).toLocaleString()} · {event.cameras.length} camera{event.cameras.length === 1 ? "" : "s"}</small></span><button disabled={!event.clip_available}>Clip unavailable</button></article>) : <small>No live Ring motion events recorded yet.</small>}</div>
    </div>}
  </section>;
}
