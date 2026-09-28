import { useCallback, useEffect, useRef, useState } from "react";
import AnalyticsView, { type AnalyticsMode, type InsightState, type SiteAnalytics as Data, type SiteSummary } from "./analytics/AnalyticsView";
import type { AlertSettingsInput, CrowdAlerts } from "./analytics/AlertsCard";
import { request } from "./platform";

export const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/**
 * Site Analytics for the web app. Starts on the place open in the workspace and
 * lets the owner switch sites; every figure is in the browser's time zone.
 * `refreshKey` reloads the numbers when new activity arrives.
 */
export default function SiteAnalytics({ siteId: initial, refreshKey }: { siteId?: string; refreshKey?: unknown }) {
  const tz = timeZone();
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [siteId, setSiteId] = useState(initial ?? "");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [insight, setInsight] = useState<InsightState | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [alerts, setAlerts] = useState<CrowdAlerts | null>(null);
  const [alertsBusy, setAlertsBusy] = useState(false);
  const [mode, setMode] = useState<AnalyticsMode>("all");
  const autoWritten = useRef(new Set<string>());

  useEffect(() => {
    if (initial) setSiteId((current) => current || initial);
  }, [initial]);

  useEffect(() => {
    let live = true;
    void request<SiteSummary[]>(`/v1/analytics/sites?tz=${encodeURIComponent(tz)}`)
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
      request<Data>(`/v1/sites/${siteId}/analytics?tz=${encodeURIComponent(tz)}&mode=${mode}`),
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
  }, [siteId, tz, refreshKey, attempt, mode]);

  const writeInsight = useCallback(async () => {
    if (!siteId) return;
    setInsightBusy(true);
    setInsightError("");
    try {
      setInsight(await request<InsightState>(`/v1/sites/${siteId}/analytics/insight`, "POST", { tz }));
    } catch (problem) {
      setInsightError(problem instanceof Error ? problem.message : "The weekly insight could not be written.");
    } finally {
      setInsightBusy(false);
    }
  }, [siteId, tz]);

  const saveAlerts = useCallback(async (next: AlertSettingsInput) => {
    if (!siteId) return;
    setAlertsBusy(true);
    try {
      const settings = await request<CrowdAlerts["settings"]>(`/v1/sites/${siteId}/alerts/settings`, "PUT", next);
      setAlerts((current) => (current ? { ...current, settings } : current));
    } finally {
      setAlertsBusy(false);
    }
  }, [siteId]);
  const acknowledge = useCallback(async (id: number) => {
    if (!siteId) return;
    await request(`/v1/sites/${siteId}/alerts/${id}/acknowledge`, "POST");
    setAlerts((current) => current && { ...current, alerts: current.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)) });
  }, [siteId]);

  // This week's note is written automatically, once, when it is missing or a week old.
  useEffect(() => {
    if (!insight?.available || !insight.stale || !data || data.site_id !== siteId || !data.totals.visits) return;
    if (autoWritten.current.has(siteId)) return;
    autoWritten.current.add(siteId);
    void writeInsight();
  }, [insight, data, siteId, writeInsight]);

  return (
    <AnalyticsView
      sites={sites}
      siteId={siteId}
      onSite={(id) => {
        setData(null);
        setInsight(null);
        setInsightError("");
        setSiteId(id);
      }}
      data={data && data.site_id === siteId ? data : null}
      loading={loading}
      error={error}
      insight={insight}
      insightBusy={insightBusy}
      insightError={insightError}
      onInsight={() => void writeInsight()}
      onRetry={() => setAttempt((n) => n + 1)}
      alerts={alerts}
      alertsBusy={alertsBusy}
      onAlertSettings={(next) => void saveAlerts(next).catch(() => undefined)}
      onAcknowledge={(id) => void acknowledge(id).catch(() => undefined)}
      mode={mode}
      onMode={(next) => {
        // Never show the other mode's figures under this mode's label, even briefly.
        if (next === mode) return;
        setData(null);
        setMode(next);
      }}
    />
  );
}
