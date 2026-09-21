import { useEffect, useMemo, useState } from "react";
import { Camera, GripVertical, RefreshCw, Video } from "lucide-react";
import { LiveVideo } from "./RingConnection";
import { request } from "./platform";

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
  const [closed, setClosed] = useState<string[]>([]);
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

  return <section className={`camera-wall-view${compact ? " compact" : ""}`} aria-label="Live camera wall">
    <div className="camera-wall-heading">
      <div>
        <span className="eyebrow">Live cameras</span>
        <h3>Camera wall</h3>
        {!compact && <p>Watch authorized Ring cameras together. Drag tiles to save their order.</p>}
      </div>
      <div className="camera-wall-heading-actions">
        <span>{wall.length}/16</span>
        <button aria-label="Refresh camera wall" disabled={loading} onClick={() => void load(true)}><RefreshCw size={15} /></button>
      </div>
    </div>
    {error && <p className="operations-error" role="alert">{error}</p>}
    <div className="wall-picker" aria-label="Cameras shown on wall">
      {data.devices.map(device => <label key={device.id}>
        <input type="checkbox" checked={wall.includes(device.id)} disabled={!wall.includes(device.id) && wall.length >= 16} onChange={event => void saveWall(event.target.checked ? [...wall, device.id] : wall.filter(id => id !== device.id))} />
        {device.name}
      </label>)}
    </div>
    <div className="camera-wall-grid">
      {wallDevices.map(device => <article key={device.id} draggable onDragStart={() => setDragging(device.id)} onDragOver={event => event.preventDefault()} onDrop={() => {
        if (!dragging || dragging === device.id) return;
        const next = wall.filter(id => id !== dragging);
        next.splice(next.indexOf(device.id), 0, dragging);
        setDragging("");
        void saveWall(next);
      }} className="camera-wall-tile">
        <div className="wall-tile-head"><GripVertical size={16} /><span className={device.online ? "online" : "offline"}>{device.online ? "Online" : "Offline"}</span></div>
        {closed.includes(device.id)
          ? <div className="wall-paused"><Camera size={24} /><p>View paused</p><button onClick={() => setClosed(items => items.filter(id => id !== device.id))}>Start live view</button></div>
          : <LiveVideo device={device as never} embedded autoReconnect close={() => setClosed(items => [...items, device.id])} />}
      </article>)}
    </div>
    {!wall.length && <div className="operations-empty"><Video size={25} /><h3>Your camera wall is empty</h3><p>Select up to 16 authorized Ring cameras.</p></div>}
    {!compact && <div className="motion-history"><h3>Motion history</h3><p>Recent Ring events stay linked to their source cameras. Recorded playback remains disabled until the official API supplies an authorized recording-history route.</p>
      <div className="motion-event-list">{data.motion_events.length ? data.motion_events.map(event => <article key={event.id}><span><strong>{event.title}</strong><small>{new Date(event.started_at).toLocaleString()} · {event.cameras.length} camera{event.cameras.length === 1 ? "" : "s"}</small></span><button disabled={!event.clip_available}>Clip unavailable</button></article>) : <small>No live Ring motion events recorded yet.</small>}</div>
    </div>}
  </section>;
}
