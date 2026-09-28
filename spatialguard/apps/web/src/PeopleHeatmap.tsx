import { useEffect, useState } from "react";
import { request } from "./platform";
import type { HeatRange, Heatmap } from "./HeatmapView";

export { HeatmapLegend, HeatmapPanel, PRESETS, type HeatRange, type Heatmap } from "./HeatmapView";

function query(range: HeatRange) {
  return "preset" in range
    ? `window=${range.preset}`
    : `since=${encodeURIComponent(range.since)}&until=${encodeURIComponent(range.until)}`;
}

/** Loads the heatmap while enabled; `refreshKey` reloads it when new activity arrives. */
export function usePeopleHeatmap(siteId: string | undefined, enabled: boolean, range: HeatRange, refreshKey: unknown) {
  const [data, setData] = useState<Heatmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const key = JSON.stringify(range);
  useEffect(() => {
    if (!enabled || !siteId) {
      setData(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    request<Heatmap>(`/v1/sites/${siteId}/heatmap?${query(range)}`)
      .then((value) => live && setData(value))
      .catch((problem) => live && setError(problem instanceof Error ? problem.message : "Heatmap unavailable"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [siteId, enabled, key, refreshKey]);
  return { data, loading, error };
}

