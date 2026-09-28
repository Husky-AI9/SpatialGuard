/**
 * Queue and crowding alerts on the Site Analytics page: who is busy right now,
 * the alerts raised recently, and each zone's limit. Presentational only, like
 * the rest of the dashboard, so the web page and the native app share it.
 */
import { useState } from "react";
import { AlertTriangle, BellRing, Check, ChevronDown, Minus, Plus, Users } from "lucide-react";
import type { components } from "../generated";

export type CrowdAlerts = components["schemas"]["CrowdAlerts"];
export type AlertSettingsInput = { enabled: boolean; window_minutes: number; limits: Record<string, number | null> };

const WINDOWS = [2, 5, 10, 15, 30];
const time = (value: string) => new Date(value).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
export const alertTitle = (a: { kind: string; zone: string }) =>
  a.kind === "queue" ? `Queue building at ${a.zone}` : `${a.zone} is getting crowded`;
/** Counts people; says so when the count included simulated (demo-mode) customers. */
export const alertDetail = (a: { count: number; window_minutes: number; simulated?: boolean }) =>
  `${a.count} ${a.count === 1 ? "person" : "people"} in the last ${a.window_minutes} min${a.simulated ? " · simulated" : ""}`;

export default function AlertsCard({ alerts, busy, onSettings, onAcknowledge }: {
  alerts: CrowdAlerts | null;
  busy: boolean;
  onSettings: (next: AlertSettingsInput) => void;
  onAcknowledge: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!alerts) return null;
  const { settings, live } = alerts;
  const limits = Object.fromEntries(settings.zones.map((z) => [z.name, z.limit ?? null]));
  const save = (patch: Partial<AlertSettingsInput>) =>
    onSettings({ enabled: settings.enabled, window_minutes: settings.window_minutes, limits, ...patch });
  const setLimit = (name: string, value: number | null) => save({ limits: { ...limits, [name]: value } });
  const recent = alerts.alerts.slice(0, 5);
  const busyNow = live.filter((z) => z.count > 0).sort((a, b) => b.count / (b.limit || 99) - a.count / (a.limit || 99));

  return (
    <section className={`an-card an-alerts${busy ? " is-saving" : ""}`} aria-labelledby="an-alerts-title">
      <header className="an-card-head">
        <div>
          <h3 id="an-alerts-title"><BellRing size={17} aria-hidden="true" />Queue & crowding alerts</h3>
          <p>Get alerted when people pile up in a zone, like a queue at the counter.</p>
        </div>
        <label className="an-switch">
          <input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked })} />
          <span aria-hidden="true" />
          <span className="an-switch-label">{settings.enabled ? "On" : "Off"}</span>
        </label>
      </header>

      <div className="an-alerts-grid">
        <div>
          <h4>Right now <small>last {settings.window_minutes} min</small></h4>
          {busyNow.length ? (
            <ul className="an-live">
              {busyNow.map((zone) => {
                const over = zone.limit != null && zone.count >= zone.limit;
                const share = zone.limit ? Math.min(1, zone.count / zone.limit) : 0;
                return (
                  <li key={zone.name} className={over ? "is-over" : ""}>
                    <span className="an-live-name">{zone.name}<small>{zone.kind === "queue" ? "Queue" : "Area"}</small></span>
                    <span className="an-live-meter" aria-hidden="true"><span style={{ width: `${Math.max(6, share * 100)}%` }} /></span>
                    <span className="an-live-count">
                      {over && <AlertTriangle size={14} aria-hidden="true" />}
                      <strong>{zone.count}</strong>{zone.limit != null ? ` of ${zone.limit}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="an-empty">No one in any zone in the last {settings.window_minutes} minutes.</p>
          )}
        </div>
        <div>
          <h4>Recent alerts</h4>
          {recent.length ? (
            <ul className="an-alert-list">
              {recent.map((alert) => (
                <li key={alert.id} className={alert.acknowledged ? "is-done" : ""}>
                  <span className={`an-alert-icon ${alert.kind}`}>{alert.kind === "queue" ? <Users size={16} /> : <AlertTriangle size={16} />}</span>
                  <span className="an-alert-copy"><strong>{alertTitle(alert)}</strong><small>{alertDetail(alert)} · {time(alert.at)}</small></span>
                  {alert.acknowledged ? (
                    <span className="an-alert-done"><Check size={14} aria-hidden="true" />Seen</span>
                  ) : (
                    <button type="button" onClick={() => onAcknowledge(alert.id)}>Got it</button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="an-empty">{settings.enabled ? "No alerts yet. You’ll see one here the moment a zone passes its limit." : "Alerts are off."}</p>
          )}
        </div>
      </div>

      <div className="an-limits">
        <button type="button" className="an-limits-toggle" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          Zone limits <ChevronDown size={16} aria-hidden="true" />
        </button>
        {editing && (
          <div className="an-limits-body">
            <label className="an-window">Count people over
              <select value={settings.window_minutes} disabled={busy} onChange={(e) => save({ window_minutes: Number(e.target.value) })}>
                {WINDOWS.map((w) => <option key={w} value={w}>{w} minutes</option>)}
              </select>
            </label>
            <ul>
              {settings.zones.map((zone) => (
                <li key={zone.name}>
                  <span className="an-live-name">{zone.name}<small>{zone.kind === "queue" ? "Queue" : "Area"}</small></span>
                  <span className="an-stepper" role="group" aria-label={`Alert limit for ${zone.name}`}>
                    <button type="button" aria-label="Lower limit" disabled={busy || zone.limit == null}
                      onClick={() => setLimit(zone.name, zone.limit != null && zone.limit > 1 ? zone.limit - 1 : null)}><Minus size={14} /></button>
                    <output>{zone.limit ?? "Off"}</output>
                    <button type="button" aria-label="Raise limit" disabled={busy || (zone.limit ?? 0) >= 50}
                      onClick={() => setLimit(zone.name, (zone.limit ?? 0) + 1)}><Plus size={14} /></button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="an-footnote">Each visitor counts once per zone. Counts come from camera estimates.</p>
          </div>
        )}
      </div>
    </section>
  );
}
