import { Maximize, Users, ZoomIn, ZoomOut } from "lucide-react";

/** Running figure with speed lines: the motion-detection mode. */
function RunningIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="15.5" cy="4" r="2" />
      <path d="M13.5 8.5 10 12l3 2.5-1.5 5.5" />
      <path d="M13.5 8.5 17 11l3-1" />
      <path d="M10 12 7.5 10.5 5 12" />
      <path d="M13 14.5 16.5 17l1 3.5" />
      <path d="M2 15h4M3 18.5h3.5M4 8.5h3" />
    </svg>
  );
}

export default function MapControls({
  motion,
  people,
  onMotion,
  onPeople,
  onZoomIn,
  onZoomOut,
  onFit,
  canZoomIn,
  canZoomOut,
}: {
  motion: boolean;
  people: boolean;
  onMotion: () => void;
  onPeople: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}) {
  return (
    <div className="map-controls" role="toolbar" aria-label="Map controls">
      <button
        className="map-control-round"
        aria-pressed={motion}
        aria-label="Motion detection"
        title={motion ? "Hide motion detection" : "Show motion detection"}
        onClick={onMotion}
      >
        <RunningIcon />
      </button>
      <button
        className="map-control-round"
        aria-pressed={people}
        aria-label="People"
        title={people ? "Hide people" : "Show people"}
        onClick={onPeople}
      >
        <Users size={20} />
      </button>
      <div className="map-control-stack">
        <button aria-label="Zoom in" title="Zoom in" disabled={!canZoomIn} onClick={onZoomIn}><ZoomIn size={20} /></button>
        <button aria-label="Zoom out" title="Zoom out" disabled={!canZoomOut} onClick={onZoomOut}><ZoomOut size={20} /></button>
        <button aria-label="Fit map" title="Fit map" onClick={onFit}><Maximize size={19} /></button>
      </div>
    </div>
  );
}
