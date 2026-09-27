import { useEffect, useState } from "react";
import { User, Users } from "lucide-react";
import { HEAT_LEGEND, type HeatGrid } from "@twinforge/spatial-view/heatmap";
import { request } from "./platform";

/**
 * A heatmap time range. Presets today; an explicit range (since/until, ISO
 * times) is already supported by the API for the finer controls to come.
 */
export type HeatRange = { preset: "1h" | "12h" | "24h" } | { since: string; until: string };

export type Heatmap = HeatGrid & {
  site_id: string;
  since: string;
  until: string;
  samples: number;
  /** Camera events with no position, spread across that camera's view. */
  estimated: number;
  estimated_cameras: { camera_id: string; events: number }[];
  unpositioned: { camera_id: string; events: number }[];
};

export const PRESETS: { id: "1h" | "12h" | "24h"; label: string; phrase: string }[] = [
  { id: "1h", label: "1 hour", phrase: "the last hour" },
  { id: "12h", label: "12 hours", phrase: "the last 12 hours" },
  { id: "24h", label: "24 hours", phrase: "the last 24 hours" },
];

/** "A", "A and B", "A, B and C". */
function names(list: string[]) {
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

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

export function HeatmapPanel({
  range,
  onRange,
  data,
  loading,
  error,
  cameraName,
}: {
  range: HeatRange;
  onRange: (range: HeatRange) => void;
  data: Heatmap | null;
  loading: boolean;
  error: string;
  cameraName: (id: string) => string;
}) {
  const active = "preset" in range ? range.preset : null;
  const phrase = PRESETS.find((p) => p.id === active)?.phrase ?? "this period";
  const missing = data?.unpositioned.reduce((sum, item) => sum + item.events, 0) ?? 0;
  const total = (data?.samples ?? 0) + (data?.estimated ?? 0);
  return (
    <div className="heatmap-panel" role="region" aria-label="People heatmap">
      <div className="heatmap-head">
        <strong>People heatmap</strong>
        <div className="heatmap-range" role="group" aria-label="Time span">
          {PRESETS.map((preset) => (
            <button key={preset.id} aria-pressed={active === preset.id} onClick={() => onRange({ preset: preset.id })}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <p className="heatmap-summary" role="status">
        {error
          ? "The heatmap couldn’t load. Try again."
          : loading && !data
            ? "Loading…"
            : !data || !total
              ? `No people seen in ${phrase}.`
              : `${total} ${total === 1 ? "sighting" : "sightings"} in ${phrase}`}
      </p>
      {!!data?.estimated && (
        <p className="heatmap-note heatmap-estimate">
          {data.samples ? `${data.estimated} ${data.estimated === 1 ? "is an estimate" : "are estimates"}` : "Estimated"}{" "}
          from where {names(data.estimated_cameras.map((item) => cameraName(item.camera_id)))}{" "}
          {data.estimated_cameras.length === 1 ? "is" : "are"} looking.
        </p>
      )}
      {missing > 0 && (
        <p className="heatmap-note">
          {missing} {missing === 1 ? "event" : "events"} from{" "}
          {names(data!.unpositioned.map((item) => cameraName(item.camera_id)))} aren’t shown.
          Place these cameras on the map to include them.
        </p>
      )}
    </div>
  );
}

/** Vertical scale, busiest at the top, as on the map legend. */
export function HeatmapLegend() {
  return (
    <div className="heatmap-legend" aria-label="Heatmap scale: more people at the top, fewer at the bottom">
      <Users size={16} aria-hidden="true" />
      <span className="heatmap-legend-bar" style={{ background: HEAT_LEGEND }} />
      <User size={16} aria-hidden="true" />
    </div>
  );
}
