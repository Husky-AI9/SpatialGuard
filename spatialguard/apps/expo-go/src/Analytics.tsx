import React, { useCallback, useEffect, useRef, useState } from "react";
import { Share, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { components } from "../../web/src/generated";
import { request } from "./api";
import { colors } from "./ui";
import mapEmbedHtml from "./mapEmbedHtml";

type Data = components["schemas"]["SiteAnalytics"];
type Summary = components["schemas"]["SiteAnalyticsSummary"];
type InsightState = components["schemas"]["SiteInsightState"];
type CrowdAlerts = components["schemas"]["CrowdAlerts"];
type AlertSettingsInput = { enabled: boolean; window_minutes: number; limits: Record<string, number | null> };
type Message =
  | { type: "ready" }
  | { type: "site"; id: string }
  | { type: "insight" }
  | { type: "retry" }
  | { type: "alertSettings"; settings: AlertSettingsInput }
  | { type: "acknowledge"; id: number }
  | { type: "export"; name: string; csv: string }
  | { type: "pair" };

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/**
 * Site Analytics on iOS: the web dashboard in the local embedded page, fed by
 * this screen. The page never sees the session token; data is fetched here and
 * pushed in, and the page asks for a site switch or a new insight by message.
 */
export default function AnalyticsScreen({ siteId: initial, refreshKey, onPair }: { siteId?: string; refreshKey?: unknown; onPair?: () => void }) {
  const tz = timeZone();
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [sites, setSites] = useState<Summary[]>([]);
  const [siteId, setSiteId] = useState(initial ?? "");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [insight, setInsight] = useState<InsightState | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [alerts, setAlerts] = useState<CrowdAlerts | null>(null);
  const [alertsBusy, setAlertsBusy] = useState(false);
  const autoWritten = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    request<Summary[]>(`/v1/analytics/sites?tz=${encodeURIComponent(tz)}`)
      .then((rows) => {
        if (!live) return;
        setSites(rows);
        setSiteId((current) => (current && rows.some((r) => r.site_id === current) ? current : rows[0]?.site_id ?? ""));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tz, refreshKey, attempt]);

  useEffect(() => {
    if (!siteId) return;
    let live = true;
    setLoading(true);
    setError("");
    Promise.all([
      request<Data>(`/v1/sites/${siteId}/analytics?tz=${encodeURIComponent(tz)}`),
      request<InsightState>(`/v1/sites/${siteId}/analytics/insight`),
      request<CrowdAlerts>(`/v1/sites/${siteId}/alerts`),
    ])
      .then(([next, state, crowd]) => {
        if (!live) return;
        setData(next);
        setInsight(state);
        setAlerts(crowd);
      })
      .catch((problem) => live && setError(problem instanceof Error ? problem.message : "Analytics are unavailable."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [siteId, tz, refreshKey, attempt]);

  const writeInsight = useCallback(async () => {
    if (!siteId) return;
    setInsightBusy(true);
    setInsightError("");
    try {
      // Bedrock usually answers in a few seconds; allow for a slow week.
      setInsight(await request<InsightState>(`/v1/sites/${siteId}/analytics/insight`, "POST", { tz }, 60000));
    } catch (problem) {
      setInsightError(problem instanceof Error ? problem.message : "The weekly insight could not be written.");
    } finally {
      setInsightBusy(false);
    }
  }, [siteId, tz]);

  // This week's note is written automatically, once, when it is missing or a week old.
  useEffect(() => {
    if (!insight?.available || !insight.stale || !data || data.site_id !== siteId || !data.totals.visits) return;
    if (autoWritten.current.has(siteId)) return;
    autoWritten.current.add(siteId);
    void writeInsight();
  }, [insight, data, siteId, writeInsight]);

  const payload = JSON.stringify({
    sites,
    siteId,
    data: data && data.site_id === siteId ? data : null,
    loading,
    error,
    insight,
    insightBusy,
    insightError,
    alerts,
    alertsBusy,
  });
  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.sgAnalytics && window.sgAnalytics(${payload}); true;`);
  }, [ready, payload]);

  const onMessage = (event: WebViewMessageEvent) => {
    let message: Message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === "ready") setReady(true);
    else if (message.type === "site" && sites.some((s) => s.site_id === message.id)) {
      setData(null);
      setInsight(null);
      setInsightError("");
      setSiteId(message.id);
    } else if (message.type === "insight") void writeInsight();
    else if (message.type === "retry") setAttempt((n) => n + 1);
    else if (message.type === "pair") onPair?.();
    else if (message.type === "export" && typeof message.csv === "string") {
      // The iOS share sheet: save to Files, AirDrop, mail or a spreadsheet app.
      void Share.share({ title: `${message.name} analytics`, message: message.csv.slice(0, 200000) }).catch(() => undefined);
    }
    else if (message.type === "alertSettings" && siteId && message.settings) {
      setAlertsBusy(true);
      request<CrowdAlerts["settings"]>(`/v1/sites/${siteId}/alerts/settings`, "PUT", message.settings)
        .then((settings) => setAlerts((current) => (current ? { ...current, settings } : current)))
        .catch(() => undefined)
        .finally(() => setAlertsBusy(false));
    } else if (message.type === "acknowledge" && siteId && Number.isInteger(message.id)) {
      setAlerts((current) => current && { ...current, alerts: current.alerts.map((a) => (a.id === message.id ? { ...a, acknowledged: true } : a)) });
      void request(`/v1/sites/${siteId}/alerts/${message.id}/acknowledge`, "POST").catch(() => undefined);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <WebView
        ref={web}
        source={{ html: mapEmbedHtml }}
        injectedJavaScriptBeforeContentLoaded="window.__sgKind = 'analytics'; true;"
        originWhitelist={["*"]}
        // The page is local; never navigate this view anywhere else.
        onShouldStartLoadWithRequest={(r) => r.url.startsWith("about:") || r.url.startsWith("data:")}
        onMessage={onMessage}
        onLoadStart={() => setReady(false)}
        setSupportMultipleWindows={false}
        allowsLinkPreview={false}
        javaScriptEnabled
        style={{ flex: 1, backgroundColor: colors.page }}
      />
    </View>
  );
}
