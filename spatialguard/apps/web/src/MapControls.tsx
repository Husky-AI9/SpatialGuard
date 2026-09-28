import { Maximize, Users, ZoomIn, ZoomOut } from "lucide-react";

export default function MapControls({
  compact = false,
  people,
  onPeople,
  onZoomIn,
  onZoomOut,
  onFit,
  canZoomIn,
  canZoomOut,
}: {
  people: boolean;
  onPeople: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  /** 3D has its own orbit controls: only the heatmap toggle. */
  compact?: boolean;
}) {
  return (
    <div className="map-controls" role="toolbar" aria-label="Map controls">
      <button
        className="map-control-round"
        aria-pressed={people}
        aria-label="People heatmap"
        title={people ? "Hide people heatmap" : "Show people heatmap"}
        onClick={onPeople}
      >
        <Users size={20} />
      </button>
      {!compact && <div className="map-control-stack">
        <button aria-label="Zoom in" title="Zoom in" disabled={!canZoomIn} onClick={onZoomIn}><ZoomIn size={20} /></button>
        <button aria-label="Zoom out" title="Zoom out" disabled={!canZoomOut} onClick={onZoomOut}><ZoomOut size={20} /></button>
        <button aria-label="Fit map" title="Fit map" onClick={onFit}><Maximize size={19} /></button>
      </div>}
    </div>
  );
}
