/**
 * Site Analytics for the native app's WebView: the web dashboard itself, fed by
 * the native screen. Like the map embed, this page has no network access and
 * never sees the session; it receives data through `window.sgAnalytics(state)`
 * and reports taps through `ReactNativeWebView.postMessage`.
 */
import { useEffect, useState } from "react";
import { type AnalyticsViewProps, type SiteAnalytics } from "../analytics/AnalyticsView";
import PhoneAnalytics from "../analytics/PhoneAnalytics";
import type { AlertSettingsInput } from "../analytics/AlertsCard";

export type AnalyticsEmbedState = Omit<AnalyticsViewProps, "onSite" | "onInsight" | "onRetry" | "onAlertSettings" | "onAcknowledge">;
export type AnalyticsEmbedMessage =
  | { type: "ready" }
  | { type: "site"; id: string }
  | { type: "insight" }
  | { type: "retry" }
  | { type: "alertSettings"; settings: AlertSettingsInput }
  | { type: "acknowledge"; id: number }
  | { type: "export"; name: string; csv: string }
  | { type: "pair" };

declare global {
  interface Window {
    sgAnalytics?: (state: Partial<AnalyticsEmbedState>) => void;
  }
}

const post = (message: AnalyticsEmbedMessage) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

/** The week's numbers as CSV, for the share sheet. */
function csv(data: SiteAnalytics) {
  const cell = (value: string | number | null | undefined) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows: (string | number | null)[][] = [
    ["Pathlight Site Analytics", data.site_name],
    ["Period", `${data.daily[0].date} to ${data.daily[data.daily.length - 1].date}`, "Time zone", data.time_zone],
    ["Visits", data.totals.visits, "Previous 7 days", data.totals.previous],
    [],
    ["Day", "Visits", "Same day last week"], ...data.daily.map((d) => [d.date, d.visits, d.previous]),
    [],
    ["Hour", "Visits", "Last week"], ...data.hourly.map((h) => [`${String(h.hour).padStart(2, "0")}:00`, h.visits, h.previous]),
    [],
    ["Zone", "Visits", "Last week", "Avg. seconds"], ...data.zones.map((z) => [z.name, z.visits, z.previous, z.dwell_s]),
    [],
    ["Entrance camera", "Visits", "Last week"], ...data.entrances.map((e) => [e.name, e.visits, e.previous]),
    [],
    ["Tracked", data.quality.tracked, "Positioned", data.quality.positioned, "Estimated", data.quality.estimated],
  ];
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}

export default function AnalyticsEmbed() {
  const [state, setState] = useState<AnalyticsEmbedState>({
    sites: [], siteId: "", data: null, loading: true, error: "",
    insight: null, insightBusy: false, insightError: "",
  });
  useEffect(() => {
    document.documentElement.classList.add("embed-analytics");
    window.sgAnalytics = (next) => setState((previous) => ({ ...previous, ...next }));
    post({ type: "ready" });
    return () => {
      window.sgAnalytics = undefined;
    };
  }, []);
  return (
    <main className="embed-analytics-page">
      <PhoneAnalytics
        {...state}
        onExport={() => state.data && post({ type: "export", name: state.data.site_name, csv: csv(state.data) })}
        onPair={() => post({ type: "pair" })}
        onSite={(id) => post({ type: "site", id })}
        onInsight={() => post({ type: "insight" })}
        onRetry={() => post({ type: "retry" })}
        onAlertSettings={(settings) => post({ type: "alertSettings", settings })}
        onAcknowledge={(id) => post({ type: "acknowledge", id })}
      />
    </main>
  );
}
