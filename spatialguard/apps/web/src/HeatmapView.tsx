/** Presentational people-heatmap panel and legend (no network access). */
import { User, Users } from "lucide-react";
import { HEAT_LEGEND, type HeatGrid } from "@twinforge/spatial-view/heatmap";

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
  /** Visits drawn here that were simulated (demo mode) or replayed, not seen by a camera. */
  simulated?: number;
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

export function HeatmapPanel({
  range,
  onRange,
  data,
  loading,
  error,
  cameraName,
  compact = false,
}: {
  range: HeatRange;
  onRange: (range: HeatRange) => void;
  data: Heatmap | null;
  loading: boolean;
  error: string;
  cameraName: (id: string) => string;
  /** Only the time span buttons, floating over the map (the phone app). */
  compact?: boolean;
}) {
  const active = "preset" in range ? range.preset : null;
  const phrase = PRESETS.find((p) => p.id === active)?.phrase ?? "this period";
  const missing = data?.unpositioned.reduce((sum, item) => sum + item.events, 0) ?? 0;
  const total = (data?.samples ?? 0) + (data?.estimated ?? 0);
  const buttons = (
    <div className="heatmap-range" role="group" aria-label="Time span">
      {PRESETS.map((preset) => (
        <button key={preset.id} aria-pressed={active === preset.id} onClick={() => onRange({ preset: preset.id })}>
          {preset.label}
        </button>
      ))}
    </div>
  );
  if (compact)
    return (
      <div className="heatmap-panel heatmap-panel-compact" role="region" aria-label="People heatmap time span">
        {buttons}
      </div>
    );
  return (
    <div className="heatmap-panel" role="region" aria-label="People heatmap">
      <div className="heatmap-head">
        <strong>People heatmap</strong>
        {buttons}
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
