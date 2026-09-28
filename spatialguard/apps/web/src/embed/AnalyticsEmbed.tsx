/**
 * Site Analytics for the native app's WebView: the web dashboard itself, fed by
 * the native screen. Like the map embed, this page has no network access and
 * never sees the session; it receives data through `window.sgAnalytics(state)`
 * and reports taps through `ReactNativeWebView.postMessage`.
 */
import { useEffect, useState } from "react";
import AnalyticsView, { type AnalyticsViewProps } from "../analytics/AnalyticsView";
import type { AlertSettingsInput } from "../analytics/AlertsCard";

export type AnalyticsEmbedState = Omit<AnalyticsViewProps, "onSite" | "onInsight" | "onRetry" | "onAlertSettings" | "onAcknowledge">;
export type AnalyticsEmbedMessage =
  | { type: "ready" }
  | { type: "site"; id: string }
  | { type: "insight" }
  | { type: "retry" }
  | { type: "alertSettings"; settings: AlertSettingsInput }
  | { type: "acknowledge"; id: number };

declare global {
  interface Window {
    sgAnalytics?: (state: Partial<AnalyticsEmbedState>) => void;
  }
}

const post = (message: AnalyticsEmbedMessage) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

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
      <AnalyticsView
        {...state}
        onSite={(id) => post({ type: "site", id })}
        onInsight={() => post({ type: "insight" })}
        onRetry={() => post({ type: "retry" })}
        onAlertSettings={(settings) => post({ type: "alertSettings", settings })}
        onAcknowledge={(id) => post({ type: "acknowledge", id })}
      />
    </main>
  );
}
