/**
 * The home map (2D, 3D, map controls, heatmap and motion) as a self-contained
 * page for the native app's WebView, so iOS shows exactly the web map.
 *
 * The page never talks to the network and never sees an account credential:
 * the native app fetches everything and pushes it in with `window.sgMap(state)`,
 * and the page reports taps back through `ReactNativeWebView.postMessage`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Map2D from "@twinforge/spatial-view/Map2D";
import Scene3D from "@twinforge/spatial-view/Scene3D";
import type { Layout } from "../../../../../packages/sdk-typescript";
import MapControls from "../MapControls";
import { HeatmapLegend, HeatmapPanel, type Heatmap } from "../HeatmapView";
import { incidentLinks, incidentMarkers } from "../incidentMap";
import { incidentMovement } from "../incidentMovement";
import type { components } from "../generated";

type Incident = components["schemas"]["Incident"];
type Track = components["schemas"]["TestVideoTrack"];

export type EmbedState = {
  view: "2D" | "3D";
  layout: Layout;
  /** Floor-plan drawing as a data URI, or "" when there is none. */
  planImage: string;
  selected: string;
  /**
   * An incident under review: its evidence replaces the map modes. `track` is
   * the person detected in the selected event's recording, followed to `at`
   * seconds of playback, exactly as the web review does.
   */
  review: { incident: Incident; step: number; track: Track | null; at: number } | null;
  /** Cameras pulsing now: live detections, or the step being replayed. */
  motionCameras: string[];
  /** Demo-mode cameras that exist only on the map; labelled SIM. */
  simulatedCameras?: string[];
  heat: { on: boolean; preset: "1h" | "12h" | "24h"; data: Heatmap | null; loading: boolean; error: string };
};

export type EmbedMessage =
  | { type: "ready" }
  | { type: "select"; id: string }
  | { type: "toggleHeat" }
  | { type: "range"; preset: "1h" | "12h" | "24h" }
  /** The map wants this touch (zoomed pan, pinch or 3D orbit), not the page scroll. */
  | { type: "capture"; value: boolean };

declare global {
  interface Window {
    /** Replace the state, or merge a partial update into it. */
    sgMap?: (state: Partial<EmbedState>) => void;
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

const post = (message: EmbedMessage) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

export default function MapEmbed() {
  const [state, setState] = useState<EmbedState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewKey, setViewKey] = useState(0);
  const pointers = useRef(new Set<number>());
  const capturing = useRef(false);

  useEffect(() => {
    window.sgMap = (next) =>
      setState((previous) => (previous ? { ...previous, ...next } : "layout" in next ? (next as EmbedState) : null));
    post({ type: "ready" });
    return () => {
      window.sgMap = undefined;
    };
  }, []);

  const evidence = useMemo(() => {
    if (!state?.review) return { markers: [], links: [] };
    const { incident: data, step, track, at } = state.review;
    const cameras = state.layout.cameras;
    const camera = cameras.find((c) => c.id === data.observations[step]?.source_id);
    const trail = track && camera ? incidentMovement(track, camera, at, data.classification ?? null) : [];
    return { markers: [...incidentMarkers(data, cameras, step), ...trail], links: incidentLinks(data) };
  }, [state?.review, state?.layout]);

  if (!state) return null;
  const { view, layout, heat, review } = state;
  const incident = !!review;
  const heatGrid = heat.on && !incident && heat.data?.values.length ? heat.data : null;
  const cameraName = (id: string) => layout.cameras.find((c) => c.id === id)?.name ?? "Camera";

  const capture = (value: boolean) => {
    if (capturing.current === value) return;
    capturing.current = value;
    post({ type: "capture", value });
  };
  const release = (id: number) => {
    pointers.current.delete(id);
    if (!pointers.current.size) capture(false);
  };

  return (
    <div
      className={`map-area map-area-${view.toLowerCase()}`}
      onPointerDownCapture={(e) => {
        pointers.current.add(e.pointerId);
        if (view === "3D" || zoom > 1.001 || pointers.current.size > 1) capture(true);
      }}
      onPointerUpCapture={(e) => release(e.pointerId)}
      onPointerCancelCapture={(e) => release(e.pointerId)}
    >
      {view === "2D" ? (
        <Map2D
          layout={layout}
          selected={state.selected}
          onSelect={(id) => post({ type: "select", id })}
          markers={evidence.markers}
          evidenceLinks={evidence.links}
          heatmap={heatGrid}
          zoom={zoom}
          onZoomChange={setZoom}
          viewKey={viewKey}
          motion
          motionCameras={state.motionCameras}
          simulatedCameras={state.simulatedCameras ?? []}
          fitBuilding
          background={state.planImage}
        />
      ) : (
        <Scene3D
          layout={layout}
          selected={state.selected}
          onSelect={(id) => post({ type: "select", id })}
          markers={evidence.markers}
          evidenceLinks={evidence.links}
          heatmap={heatGrid}
          simulatedCameras={state.simulatedCameras ?? []}
        />
      )}
      {view === "2D" && state.motionCameras.length > 0 && !heat.on && !incident && (
        <p className="motion-status motion-status-live" role="status">
          <span aria-hidden="true" />
          {`Motion · ${state.motionCameras.map(cameraName).join(", ")}`}
        </p>
      )}
      {heat.on && !incident && (
        <>
          <HeatmapPanel
            range={{ preset: heat.preset }}
            onRange={(range) => "preset" in range && post({ type: "range", preset: range.preset })}
            data={heat.data}
            loading={heat.loading}
            error={heat.error}
            cameraName={cameraName}
            compact
          />
          {heatGrid && <HeatmapLegend />}
        </>
      )}
      {!incident && (
        <MapControls
          compact={view === "3D"}
          people={heat.on}
          onPeople={() => post({ type: "toggleHeat" })}
          canZoomIn={zoom < 4}
          canZoomOut={zoom > 0.65}
          onZoomIn={() => setZoom((z) => Math.min(4, z * 1.3))}
          onZoomOut={() => setZoom((z) => Math.max(0.65, z / 1.3))}
          onFit={() => {
            setZoom(1);
            setViewKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
