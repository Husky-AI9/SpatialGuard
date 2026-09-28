/** Demo mode: simulated café customers for recording the product video. */
import { useEffect, useState } from "react";
import { CalendarDays, Trash2, Users } from "lucide-react";
import { request } from "./platform";
import type { components } from "./generated";

type DemoStatus = components["schemas"]["DemoStatus"];

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

export default function DemoTools({ siteId, siteName }: { siteId?: string; siteName?: string }) {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    if (!siteId) return;
    try {
      setStatus(await request<DemoStatus>(`/v1/demo/sites/${siteId}`));
    } catch {
      setError("Demo mode is unavailable for this place.");
    }
  };
  useEffect(() => {
    setStatus(null);
    setMessage("");
    setError("");
    void load();
  }, [siteId]);
  // While a rush is running, follow it until the last customer arrives.
  useEffect(() => {
    if (!status?.rush_active) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [status?.rush_active, siteId]);

  const run = async (name: string, action: () => Promise<DemoStatus>, done: (s: DemoStatus) => string) => {
    setBusy(name);
    setError("");
    setMessage("");
    try {
      const next = await action();
      setStatus(next);
      setMessage(done(next));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That didn’t work. Try again.");
    } finally {
      setBusy("");
    }
  };

  if (!siteId) return <section className="settings-card"><h2>Demo mode</h2><p>Choose a place first.</p></section>;
  return (
    <section className="settings-card demo-tools" aria-labelledby="demo-tools-title">
      <h2 id="demo-tools-title">Demo mode · {siteName}</h2>
      <p>
        Simulated customers fill the café for the video. They are labelled “Simulated” everywhere, never
        come from a camera, and Analytics can hide them with <strong>Live only</strong>. Only this account sees demo mode.
      </p>
      <p className="demo-status" role="status">
        {status
          ? `${status.simulated_visits} simulated visits · ${status.live_visits} live Ring visits${status.rush_active ? " · lunch rush running" : ""}`
          : "Loading…"}
      </p>
      <div className="demo-actions">
        <button className="primary" disabled={!!busy}
          onClick={() => void run("week", () => request<DemoStatus>(`/v1/demo/sites/${siteId}/history`, "POST", { tz: timeZone(), seed: 1 }, 90000), (s) => `Created two weeks of simulated customers (${s.simulated_visits} visits).`)}>
          <CalendarDays size={16} /> {busy === "week" ? "Creating…" : "Create two simulated weeks"}
        </button>
        <button disabled={!!busy || !!status?.rush_active}
          onClick={() => void run("rush", () => request<DemoStatus>(`/v1/demo/sites/${siteId}/rush`, "POST", { customers: 6, interval_seconds: 12 }), () => "Lunch rush started: 6 simulated customers join the counter queue over about a minute.")}>
          <Users size={16} /> {status?.rush_active ? "Rush running…" : "Start a lunch rush"}
        </button>
        <button className="danger-quiet" disabled={!!busy || !status?.simulated_visits}
          onClick={() => {
            if (!window.confirm("Remove every simulated customer, and the alerts and insight they produced? Real Ring visits stay.")) return;
            void run("clear", () => request<DemoStatus>(`/v1/demo/sites/${siteId}/simulated`, "DELETE", undefined, 60000),
              () => "Removed the simulated customers. Real Ring visits are untouched.");
          }}>
          <Trash2 size={16} /> Remove simulated data
        </button>
      </div>
      {message && <p className="demo-message">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
