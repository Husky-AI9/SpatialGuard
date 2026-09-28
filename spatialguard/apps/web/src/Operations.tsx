import { useEffect, useState } from "react";
import { Bell, Check, Clock3, Download, RefreshCw, Share2, Timer, Wifi, WifiOff, X } from "lucide-react";
import { ApiError, request } from "./platform";
import RecoveryNotice from "./RecoveryNotice";
import CameraMark from "./CameraMark";

type HealthPoint = { at: string; online: boolean; source: string };
type Device = {
  id: string; name: string; checked_at: string; online: boolean;
  uptime_percent: number | null; history: HealthPoint[];
  site_id: string | null; camera_id: string | null;
  status: Record<string, unknown>; capabilities: Record<string, unknown>;
};
type Alert = { id: string; device: string; kind: "offline" | "recovered"; at: number; acknowledged: number };
type Preferences = { delay_seconds: number; browser_enabled: number; email_enabled: number; email: string };
type Project = {
  id: string; device: string; site: string; camera: string; name: string;
  cadence_minutes: number; start_hour: number; end_hour: number; timezone: string;
  enabled: number; frame_count: number; frames: { id: string; at: number }[];
};
type MotionEvent = { id: string; title: string; started_at: string; site_id: string; cameras: string[]; clip_available: boolean };
type OperationsData = { devices: Device[]; alerts: Alert[]; preferences: Preferences; wall: string[]; projects: Project[]; motion_events: MotionEvent[] };

const blank: OperationsData = {
  devices: [], alerts: [], preferences: { delay_seconds: 0, browser_enabled: 0, email_enabled: 0, email: "" }, wall: [], projects: [], motion_events: [],
};

function sevenDays(device: Device) {
  const points = [...device.history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return Array.from({ length: 7 }, (_, index) => {
    const end = Date.now() - (6 - index) * 86400_000;
    const known = points.filter(point => Date.parse(point.at) <= end).at(-1);
    return known?.online ?? (index === 6 ? device.online : null);
  });
}

type FeatureFlags = { uptime_history: boolean; offline_alerts: boolean; timelapse: boolean };
export default function Operations({ features }: { features: FeatureFlags }) {
  const [data, setData] = useState<OperationsData>(blank);
  const [section, setSection] = useState<"Health" | "Time-lapse">("Health");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ device: "", name: "", cadence_minutes: 60, start_hour: 7, end_hour: 19, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Phoenix" });
  const sections: ("Health" | "Time-lapse")[] = features.timelapse ? ["Health", "Time-lapse"] : ["Health"];
  const load = async (refresh = false) => {
    setLoading(true); setError("");
    try {
      if (refresh) await request("/v1/ring/devices/refresh", "POST");
      const result = await request<OperationsData>("/v1/ring/operations");
      setData(result);
      if (!form.device && result.devices[0]) setForm(value => ({ ...value, device: result.devices[0].id }));
    } catch (reason) {
      // Ring not linked or not allowed yet is the empty state, not an error.
      if (!(reason instanceof ApiError && [403, 404, 409].includes(reason.status)))
        setError(reason instanceof Error ? reason.message : "Operations unavailable");
    }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void request<OperationsData>("/v1/ring/operations").then(result => {
        setData(current => ({
          ...current,
          devices: result.devices,
          alerts: result.alerts,
          projects: result.projects,
          motion_events: result.motion_events,
        }));
      }).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const unseen = data.alerts.filter(alert => !alert.acknowledged);
    if (!data.preferences.browser_enabled || !("Notification" in window) || Notification.permission !== "granted") return;
    unseen.forEach(alert => {
      const device = data.devices.find(item => item.id === alert.device);
      new Notification(alert.kind === "offline" ? "Ring camera offline" : "Ring camera recovered", {
        body: `${device?.name ?? "Ring device"} ${alert.kind === "offline" ? "went offline" : "is back online"}. Convenience alert only.`,
        tag: alert.id,
      });
    });
  }, [data.alerts, data.devices, data.preferences.browser_enabled]);

  const selectedProjectDevice = data.devices.find(device => device.id === form.device);
  const shareReel = async (project: Project) => {
    try {
      const response = await fetch(`/v1/ring/timelapses/${project.id}/reel`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Capture at least one frame before sharing.");
      const file = new File([await response.blob()], `${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "spatialguard"}.gif`, { type: "image/gif" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: project.name, files: [file] });
      } else {
        const link = document.createElement("a"); link.href = URL.createObjectURL(file); link.download = file.name; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not share reel"); }
  };

  return <section className="operations-page" aria-label="Ring operations">
    <header className="operations-heading">
      <div><h2>Camera health</h2></div>
      <button onClick={() => void load(true)} disabled={loading}><RefreshCw size={16} />Refresh devices</button>
    </header>
    <div className="operations-tabs" role="tablist" aria-label="Operations tools">
      {sections.map(name => <button key={name} role="tab" aria-selected={section === name} onClick={() => setSection(name)}>{name === "Health" ? <Wifi size={16} /> : <Timer size={16} />}{name}</button>)}
    </div>
    {error && <RecoveryNotice message={error} onRetry={() => void load()} />}

    {section === "Health" && <div className="health-layout">
      <div className="health-main">
        <div className="section-title"><div><h3>Camera status</h3><p>{features.uptime_history ? "Last 7 days" : "Latest connectivity state reported by Ring."}</p></div><span>{data.devices.filter(device => device.online).length}/{data.devices.length} online</span></div>
        <div className="health-list">{data.devices.length ? data.devices.map(device => <article className="health-device" key={device.id}>
          <span className={`health-light ${device.online ? "online" : "offline"}`}>{device.online ? <Wifi size={17} /> : <WifiOff size={17} />}</span>
          <div className="health-copy"><h4>{device.name}</h4><p>{device.online ? "Online" : "Offline"} · checked {new Date(device.checked_at).toLocaleString()}</p></div>
          {features.uptime_history && <><div className="uptime-strip" aria-label={`${device.name} seven-day status`}>{sevenDays(device).map((online, index) => <span key={index} className={online === null ? "unknown" : online ? "online" : "offline"} title={online === null ? "No data" : online ? "Online" : "Offline"} />)}</div><strong>{device.uptime_percent === null ? "New" : `${device.uptime_percent}%`}</strong></>}
        </article>) : <div className="operations-empty"><CameraMark size={24} /><h3>No Ring cameras connected</h3><p>Link Ring in Settings to see your cameras here.</p></div>}</div>
      </div>
      {features.offline_alerts && <aside className="health-side">
        <div className="ops-card"><h3><Bell size={17} /> Alert delivery</h3>
          <label>Wait before offline alert<select value={data.preferences.delay_seconds} onChange={event => setData(current => ({ ...current, preferences: { ...current.preferences, delay_seconds: Number(event.target.value) } }))}><option value="0">Immediately</option><option value="60">1 minute</option><option value="300">5 minutes</option><option value="900">15 minutes</option></select></label>
          <label className="check-row"><input type="checkbox" checked={!!data.preferences.browser_enabled} onChange={event => setData(current => ({ ...current, preferences: { ...current.preferences, browser_enabled: Number(event.target.checked) } }))} />Browser alerts while Pathlight is open</label>
          <label className="check-row"><input type="checkbox" checked={!!data.preferences.email_enabled} onChange={event => setData(current => ({ ...current, preferences: { ...current.preferences, email_enabled: Number(event.target.checked) } }))} />Email alerts</label>
          {!!data.preferences.email_enabled && <label>Email address<input type="email" value={data.preferences.email} onChange={event => setData(current => ({ ...current, preferences: { ...current.preferences, email: event.target.value } }))} /></label>}
          <button className="primary" onClick={() => void (async () => {
            if (data.preferences.browser_enabled && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
            await request("/v1/ring/operations/preferences", "PATCH", { ...data.preferences, browser_enabled: !!data.preferences.browser_enabled, email_enabled: !!data.preferences.email_enabled });
          })()}>Save alert settings</button>
          <small>Alerts are notices, not emergency monitoring.</small>
        </div>
        <div className="ops-card"><h3>Recent status alerts</h3>{data.alerts.length ? data.alerts.slice(0, 8).map(alert => <div className={`health-alert ${alert.kind}`} key={alert.id}><span>{alert.kind === "offline" ? <WifiOff size={15} /> : <Check size={15} />}</span><div><strong>{data.devices.find(device => device.id === alert.device)?.name ?? "Ring device"}</strong><small>{alert.kind === "offline" ? "Went offline" : "Came back online"} · {new Date(alert.at * 1000).toLocaleString()}</small></div>{!alert.acknowledged && <button aria-label="Acknowledge alert" onClick={() => void request(`/v1/ring/operations/alerts/${alert.id}/acknowledge`, "POST").then(() => load())}><X size={14} /></button>}</div>) : <p className="muted">No status changes recorded.</p>}</div>
      </aside>}
    </div>}

    {features.timelapse && section === "Time-lapse" && <div className="timelapse-layout">
      <div className="timelapse-main"><div className="section-title"><div><h3>Time-lapse projects</h3><p>Scheduled snapshots turned into a short reel.</p></div><span>{data.projects.length}/8 projects</span></div>
        <div className="project-grid">{data.projects.map(project => <article className="timelapse-project" key={project.id}><div className="project-head"><div><h4>{project.name}</h4><p>Every {project.cadence_minutes} min · {String(project.start_hour).padStart(2,"0")}:00–{String(project.end_hour).padStart(2,"0")}:00</p></div><button aria-label={`Delete ${project.name}`} onClick={() => void request(`/v1/ring/timelapses/${project.id}`, "DELETE").then(() => load())}><X size={15} /></button></div>
          <div className="frame-strip">{project.frames.length ? project.frames.slice(0, 4).map(frame => <img key={frame.id} src={`/v1/ring/timelapses/${project.id}/frames/${frame.id}`} alt={`Captured ${new Date(frame.at * 1000).toLocaleString()}`} />) : <div><Clock3 size={22} /><span>No frames yet</span></div>}</div>
          <div className="project-actions"><button onClick={() => void request(`/v1/ring/timelapses/${project.id}/capture`, "POST").then(() => load())}><CameraMark size={15} />Capture now</button><a className={project.frame_count ? "button-link" : "button-link disabled"} href={project.frame_count ? `/v1/ring/timelapses/${project.id}/reel` : undefined} download><Download size={15} />Download GIF</a><button disabled={!project.frame_count} onClick={() => void shareReel(project)}><Share2 size={15} />Share reel</button></div><small>{project.frame_count} frame{project.frame_count === 1 ? "" : "s"} · newest 500 retained locally</small>
        </article>)}</div>
      </div>
      <aside className="ops-card timelapse-create"><h3>Create a project</h3>
        <label>Ring camera<select value={form.device} onChange={event => setForm({ ...form, device: event.target.value })}>{data.devices.filter(device => device.site_id && device.camera_id).map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
        <label>Project name<input value={form.name} placeholder="Garden growth" maxLength={80} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Capture cadence<select value={form.cadence_minutes} onChange={event => setForm({ ...form, cadence_minutes: Number(event.target.value) })}><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option><option value="360">Every 6 hours</option><option value="1440">Once a day</option></select></label>
        <div className="hour-row"><label>Start hour<input type="number" min="0" max="23" value={form.start_hour} onChange={event => setForm({ ...form, start_hour: Number(event.target.value) })} /></label><label>End hour<input type="number" min="0" max="23" value={form.end_hour} onChange={event => setForm({ ...form, end_hour: Number(event.target.value) })} /></label></div>
        <label>Time zone<input value={form.timezone} onChange={event => setForm({ ...form, timezone: event.target.value })} /></label>
        <button className="primary" disabled={!selectedProjectDevice?.site_id || !selectedProjectDevice?.camera_id || !form.name.trim()} onClick={() => void request("/v1/ring/timelapses", "POST", { ...form, site: selectedProjectDevice!.site_id, camera: selectedProjectDevice!.camera_id }).then(() => { setForm(value => ({ ...value, name: "" })); return load(); })}>Create time-lapse</button>
      </aside>
    </div>}
  </section>;
}
