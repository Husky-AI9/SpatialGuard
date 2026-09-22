import { useEffect, useRef, useState } from "react";
import type { Camera, Layout } from "../sdk-typescript";
import { bounds } from "./geometry";
import TopDownPerson, { activityColor, type ActivityKind } from "./TopDownPerson";
import CameraGlyph, {
  aimPoint,
  coveragePath,
  heading,
  snap,
  type CameraChange,
} from "./cameraGlyph";
export type Marker = {
  id: string;
  xy: [number, number];
  selected?: boolean;
  approximate?: boolean;
  label?: string;
  uncertainty_m?: number;
  actorKind?: ActivityKind;
  actorLabel?: string;
  reviewLevel?: "routine" | "review" | "urgent";
  headingDegrees?: number;
  /** An unobserved gap sits between this position and the previous one. */
  gapBefore?: boolean;
  /** Evidence was reported by this camera; this is not a person coordinate. */
  evidenceNode?: boolean;
  /** Keep an estimated stationary object visible after the moving actor leaves. */
  persistent?: boolean;
};
export type EvidenceLink = {
  id: string;
  fromMarkerId: string;
  toMarkerId: string;
  gapSeconds?: number;
  label?: string;
};
const actorColor = (marker: Marker) => activityColor(marker.actorKind ?? "person");

function ActorGlyph({ marker }: { marker: Marker }) {
  const color = actorColor(marker);
  const label = marker.actorLabel ?? "Person detected";
  const width = Math.max(1.35, label.length * 0.17 + 0.3);
  return (
    <g
      className={`map-actor map-actor-${marker.actorKind ?? "person"}${marker.approximate ? " approximate-marker" : ""}`}
      transform={`translate(${marker.xy[0]} ${-marker.xy[1]})`}
      aria-label={label}
    >
      <g transform={`rotate(${90 - (marker.headingDegrees ?? 90)})`}>
        <g transform="translate(-.34 -.34) scale(.010625)">
          <TopDownPerson kind={marker.actorKind} />
        </g>
      </g>
      <rect
        x={-width / 2}
        y="-.77"
        width={width}
        height=".32"
        rx=".07"
        fill={color}
        stroke="#fff"
        strokeWidth=".035"
      />
      <text x="0" y="-.55" textAnchor="middle" fontSize=".22" fontWeight="700" fill="#fff">
        {label}
      </text>
      <title>{label} · {marker.reviewLevel === "urgent" ? "urgent review" : marker.reviewLevel === "routine" ? "routine review" : "review required"}</title>
    </g>
  );
}
const LABEL = 0.44;
// SVG gives no cheap text measurement, so approximate from the glyph count and
// only stack words when the name genuinely will not fit the room.
const fits = (text: string, width: number) => text.length * LABEL * 0.52 <= width * 0.92;
export type { CameraChange } from "./cameraGlyph";
type XY = [number, number];
type Drag = { id: string; mode: "move" | "aim"; start: XY; change: CameraChange };

export default function Map2D({
  layout,
  selected,
  onSelect,
  markers = [],
  evidenceLinks = [],
  editable = false,
  placing = false,
  background = "",
  fitBuilding = false,
  onCameraChange,
  onPlace,
}: {
  layout: Layout;
  selected: string;
  onSelect: (id: string) => void;
  markers?: Marker[];
  evidenceLinks?: EvidenceLink[];
  editable?: boolean;
  placing?: boolean;
  /** Object URL of the traced floor-plan drawing, shown beneath the geometry. */
  background?: string;
  /** Fit the house and active camera, without distant unused coverage shrinking the plan. */
  fitBuilding?: boolean;
  onCameraChange?: (id: string, change: CameraChange) => void;
  onPlace?: (xy: XY) => void;
}) {
  const plan = background ? layout.floor_plan : null;
  const viewLayout = fitBuilding ? {
    ...layout,
    // Keep every camera selectable; only the active camera's coverage affects fit.
    cameras: layout.cameras.map((camera) => camera.id === selected ? camera : { ...camera, range_m: 0 }),
    floor_plan: null,
  } : layout;
  const [baseX, baseY, baseWidth, baseHeight] = bounds(viewLayout, fitBuilding ? 0.65 : 2.4, fitBuilding ? 0.45 : 1.2);
  // Home shows the house at 70% of its fitted size, with more surrounding ground.
  const viewScale = fitBuilding ? 0.7 : 1;
  const w = baseWidth / viewScale, h = baseHeight / viewScale;
  const x = baseX - (w - baseWidth) / 2, y = baseY - (h - baseHeight) / 2;
  const [zoom, setZoom] = useState(1);
  const zoomedWidth = w / zoom, zoomedHeight = h / zoom;
  const zoomedX = x + (w - zoomedWidth) / 2;
  const zoomedY = y + (h - zoomedHeight) / 2;
  const svg = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Drag | null>(null);
  const moveable = editable && !placing && !!onCameraChange;
  useEffect(() => {
    if (moveable) setPreview(null);
  }, [moveable, layout]);
  // Explicit Y inversion at the SVG boundary; canonical values stay untouched.
  const eventPoint = (event: { clientX: number; clientY: number }): XY => {
    const el = svg.current!;
    const point = el.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const value = point.matrixTransform(el.getScreenCTM()!.inverse());
    return [value.x, -value.y];
  };
  const cancelDrag = () => {
    dragRef.current = null;
    setPreview(null);
  };
  const startDrag = (event: React.PointerEvent, camera: Camera, mode: "move" | "aim") => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect(camera.id);
    if (!moveable) return;
    event.preventDefault();
    svg.current!.setPointerCapture(event.pointerId);
    const drag: Drag = { id: camera.id, mode, start: eventPoint(event), change: {} };
    dragRef.current = drag;
    setPreview(drag);
  };
  const nudge = (camera: Camera, event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(camera.id);
      return;
    }
    if (!moveable) return;
    const step = event.shiftKey ? 0.5 : 0.1;
    const delta: Record<string, XY> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (!delta[event.key]) return;
    event.preventDefault();
    const [dx, dy] = delta[event.key];
    onCameraChange!(camera.id, {
      position_m: [
        snap(camera.position_m[0] + dx),
        snap(camera.position_m[1] + dy),
        camera.position_m[2],
      ],
    });
  };
  return (
    <svg
      ref={svg}
      className={`spatial-map${moveable ? " editable" : ""}${placing ? " placing" : ""}`}
      viewBox={`${zoomedX} ${-zoomedY - zoomedHeight} ${zoomedWidth} ${zoomedHeight}`}
      role="group"
      aria-label={evidenceLinks.length
        ? "Home floor map with camera observations, possible continuations, and unknown gaps"
        : "Home floor map. Synthetic replay positions."}
      onClick={
        placing && onPlace
          ? (e) => onPlace(eventPoint(e).map(snap) as XY)
          : undefined
      }
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setZoom((current) => Math.max(0.65, Math.min(3.5,
          current * (event.deltaY < 0 ? 1.12 : 0.89))));
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const camera = layout.cameras.find((c) => c.id === drag.id);
        if (!camera) return;
        const [px, py] = eventPoint(e);
        const [cx, cy, cz] = camera.position_m;
        if (drag.mode === "move")
          drag.change = {
            position_m: [snap(cx + px - drag.start[0]), snap(cy + py - drag.start[1]), cz],
          };
        else if (Math.hypot(px - cx, py - cy) > 0.1)
          drag.change = {
            heading_degrees: heading(Math.round((Math.atan2(py - cy, px - cx) * 180) / Math.PI)),
          };
        setPreview({ ...drag });
      }}
      onPointerUp={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        if (svg.current!.hasPointerCapture(e.pointerId))
          svg.current!.releasePointerCapture(e.pointerId);
        if (Object.keys(drag.change).length) onCameraChange!(drag.id, drag.change);
        else setPreview(null);
      }}
      onPointerCancel={cancelDrag}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancelDrag();
      }}
    >
      <defs>
        <radialGradient id="spatial-coverage">
          <stop offset="0%" stopColor="#5b4fe8" stopOpacity=".26" />
          <stop offset="100%" stopColor="#5b4fe8" stopOpacity=".04" />
        </radialGradient>
        <radialGradient id="spatial-coverage-active">
          <stop offset="0%" stopColor="#5b4fe8" stopOpacity=".42" />
          <stop offset="100%" stopColor="#5b4fe8" stopOpacity=".08" />
        </radialGradient>
      </defs>
      <rect
        className="map-ground"
        pointerEvents="none"
        x={x}
        y={-y - h}
        width={w}
        height={h}
        fill="#cfe0c2"
      />
      {plan && (
        <image
          href={background}
          x={plan.origin_xy_m[0]}
          y={-plan.origin_xy_m[1] - plan.height_m}
          width={plan.width_m}
          height={plan.height_m}
          preserveAspectRatio="none"
          opacity=".5"
        />
      )}
      {layout.rooms.map((room) => {
        const pts = room.polygon_xy_m;
        const cx = pts.reduce((v, p) => v + p[0], 0) / pts.length,
          cy = pts.reduce((v, p) => v + p[1], 0) / pts.length;
        const span = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
        const lines = fits(room.name, span) ? [room.name] : room.name.split(" ");
        return (
          <g
            key={room.id}
            role="button"
            tabIndex={0}
            aria-label={room.name}
            aria-pressed={selected === room.id}
            onClick={() => onSelect(room.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(room.id);
              }
            }}
          >
            <polygon
              points={pts.map(([a, b]) => `${a},${-b}`).join(" ")}
              fill={selected === room.id ? "#ddd9fb" : "#e8ecf9"}
              fillOpacity={plan ? 0.62 : 1}
              stroke="#8f9bc9"
              strokeWidth=".05"
            />
            <text
              x={cx}
              y={-cy}
              textAnchor="middle"
              fill="#3a3f63"
              fontSize={LABEL}
              stroke="#f4f6fd"
              strokeWidth=".14"
              paintOrder="stroke"
              strokeLinejoin="round"
              pointerEvents="none"
            >
              {lines.map((word, j) => (
                <tspan
                  key={j}
                  x={cx}
                  dy={j === 0 ? -(lines.length - 1) * (LABEL / 2) : LABEL}
                >
                  {word}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
      {layout.portals.map((p) => (
        <line
          key={p.id}
          x1={p.segment_xy_m[0][0]}
          y1={-p.segment_xy_m[0][1]}
          x2={p.segment_xy_m[1][0]}
          y2={-p.segment_xy_m[1][1]}
          stroke="#ffffff"
          strokeWidth=".14"
        />
      ))}
      {fitBuilding && <g className="map-scale" pointerEvents="none" transform={`translate(${x + .5} ${-y - .45})`}>
        <path d="M0 -.12V0H2V-.12" fill="none" stroke="#34383a" strokeWidth=".04" />
        <text x="1" y="-.2" textAnchor="middle" fontSize=".23" fill="#34383a">2 m · map scale</text>
      </g>}
      {layout.cameras.map((original) => {
        const c: Camera =
          preview?.id === original.id ? { ...original, ...preview.change } : original;
        const active = selected === c.id;
        const [ax, ay] = aimPoint(c);
        return (
          <g key={c.id} className="camera-group">
            <path
              d={coveragePath(c)}
              fill={`url(#spatial-coverage${active ? "-active" : ""})`}
              stroke={active ? "#5b4fe8" : "#9aa4d2"}
              strokeWidth={active ? ".04" : ".025"}
              strokeDasharray=".09 .07"
              pointerEvents="none"
            />
            <g
              className="camera-marker"
              role="button"
              tabIndex={0}
              aria-label={
                moveable ? `${c.name}. Drag to move, arrow keys nudge.` : c.name
              }
              aria-pressed={active}
              onPointerDown={(e) => startDrag(e, original, "move")}
              onKeyDown={(e) => nudge(c, e)}
            >
              <circle cx={c.position_m[0]} cy={-c.position_m[1]} r=".34" fill="transparent" />
              <CameraGlyph camera={c} fill="#ffffff" scale={1.18} />
              <CameraGlyph camera={c} fill={active ? "#5b4fe8" : "#39406b"} />
              <title>
                {c.name} · aimed {Math.round(heading(c.heading_degrees))}°, {Math.round(c.fov_degrees)}°
                field of view, {c.range_m} m range
              </title>
            </g>
            <text
              className="camera-label"
              x={c.position_m[0]}
              y={-c.position_m[1] + 0.46}
              textAnchor="middle"
              fontSize=".3"
              fill={active ? "#8f2727" : "#3f3a3a"}
              stroke="#f2efec"
              strokeWidth=".1"
              paintOrder="stroke"
              strokeLinejoin="round"
              pointerEvents="none"
            >
              {c.name}
            </text>
            {active && moveable && (
              <g
                className="camera-aim"
                role="button"
                tabIndex={0}
                aria-label={`Aim ${c.name}. Drag, or use left and right arrow keys.`}
                onPointerDown={(e) => startDrag(e, original, "aim")}
                onKeyDown={(e) => {
                  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
                  e.preventDefault();
                  onCameraChange!(c.id, {
                    heading_degrees: heading(
                      c.heading_degrees + (e.key === "ArrowLeft" ? 5 : -5),
                    ),
                  });
                }}
              >
                <line
                  x1={c.position_m[0]}
                  y1={-c.position_m[1]}
                  x2={ax}
                  y2={-ay}
                  stroke="#5b4fe8"
                  strokeWidth=".04"
                  strokeDasharray=".1 .08"
                  pointerEvents="none"
                />
                <circle className="camera-aim-handle" cx={ax} cy={-ay} r=".32" fill="transparent" />
                <circle cx={ax} cy={-ay} r=".15" fill="#fff" stroke="#5b4fe8" strokeWidth=".055" />
              </g>
            )}
          </g>
        );
      })}
      {evidenceLinks.map((link) => {
        const from = markers.find((marker) => marker.id === link.fromMarkerId);
        const to = markers.find((marker) => marker.id === link.toMarkerId);
        if (!from || !to) return null;
        const first: XY = [
          from.xy[0] + (to.xy[0] - from.xy[0]) * .42,
          from.xy[1] + (to.xy[1] - from.xy[1]) * .42,
        ];
        const second: XY = [
          from.xy[0] + (to.xy[0] - from.xy[0]) * .58,
          from.xy[1] + (to.xy[1] - from.xy[1]) * .58,
        ];
        const mid: XY = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
        const gap = link.gapSeconds === undefined ? "Unknown gap" : `${Math.round(link.gapSeconds)}s gap`;
        return (
          <g key={link.id} className="evidence-link" pointerEvents="none">
            <line x1={from.xy[0]} y1={-from.xy[1]} x2={first[0]} y2={-first[1]}
              stroke="#b86c18" strokeWidth=".09" strokeDasharray=".18 .12" strokeLinecap="round" />
            <line x1={first[0]} y1={-first[1]} x2={second[0]} y2={-second[1]}
              stroke="#69707c" strokeWidth=".075" strokeDasharray=".04 .11" strokeLinecap="round" />
            <line x1={second[0]} y1={-second[1]} x2={to.xy[0]} y2={-to.xy[1]}
              stroke="#b86c18" strokeWidth=".09" strokeDasharray=".18 .12" strokeLinecap="round" />
            <g transform={`translate(${mid[0]} ${-mid[1]})`}>
              <circle r=".26" fill="#f7f3ed" stroke="#69707c" strokeWidth=".04" />
              <text x="0" y=".1" textAnchor="middle" fontSize=".28" fontWeight="700" fill="#555b65">?</text>
              <title>{link.label ?? `Possible continuation with ${gap.toLowerCase()}`}</title>
            </g>
          </g>
        );
      })}
      {!evidenceLinks.length && markers.slice(1).map((to, i) => {
        const from = markers[i];
        if (to.approximate && to.gapBefore) return null;
        const mid = [(from.xy[0] + to.xy[0]) / 2, (from.xy[1] + to.xy[1]) / 2];
        return (
          <g key={"leg-" + to.id} pointerEvents="none">
            <line
              className={to.approximate ? "estimated-trail-segment" : undefined}
              x1={from.xy[0]}
              y1={-from.xy[1]}
              x2={to.xy[0]}
              y2={-to.xy[1]}
              stroke={to.approximate ? "#b45309" : to.gapBefore ? "#8d6a6a" : "#a73030"}
              strokeWidth={to.gapBefore ? ".05" : ".07"}
              strokeDasharray={to.gapBefore ? ".14 .12" : undefined}
              strokeLinecap="round"
              opacity={to.gapBefore ? 0.8 : 0.48}
            />
            {to.gapBefore && (
              <text
                x={mid[0]}
                y={-mid[1] + 0.1}
                textAnchor="middle"
                fontSize=".38"
                fontWeight="600"
                fill="#8d4a4a"
                stroke="#f2efec"
                strokeWidth=".11"
                paintOrder="stroke"
              >
                ?
              </text>
            )}
          </g>
        );
      })}
      {markers.map((p) => p.approximate && !p.selected && !p.persistent ? null : (
        <g key={p.id} pointerEvents="none">
          {p.approximate && p.selected && (
            <circle
              className="approximate-marker-uncertainty"
              cx={p.xy[0]}
              cy={-p.xy[1]}
              r={p.uncertainty_m ?? 0.65}
              fill={p.actorKind ? actorColor(p) : "#d97706"}
              fillOpacity=".1"
              stroke={p.actorKind ? actorColor(p) : "#b45309"}
              strokeWidth=".035"
              strokeDasharray=".12 .09"
            />
          )}
          {p.evidenceNode && (
            <>
              <circle cx={p.xy[0]} cy={-p.xy[1]} r=".31" fill="#f5b64c" fillOpacity=".18"
                stroke="#b86c18" strokeWidth=".055" strokeDasharray=".11 .08" />
              <circle cx={p.xy[0]} cy={-p.xy[1]} r=".13" fill="#b86c18" stroke="#fff" strokeWidth=".045">
                <title>{p.label ?? "Activity observed by this camera; person position unknown"}</title>
              </circle>
            </>
          )}
          {p.selected && !p.evidenceNode && (
            <circle
              cx={p.xy[0]}
              cy={-p.xy[1]}
              r=".34"
              fill={p.approximate ? "#d97706" : "#a73030"}
              opacity=".18"
            />
          )}
          {p.evidenceNode ? null : p.actorKind ? (
            <ActorGlyph marker={p} />
          ) : (
            <circle
              className={p.approximate ? "approximate-marker" : undefined}
              cx={p.xy[0]}
              cy={-p.xy[1]}
              r={p.selected ? ".19" : ".11"}
              fill={p.approximate ? (p.selected ? "#b45309" : "#d99a55") : p.selected ? "#a01f1f" : "#c07878"}
              stroke="#fff"
              strokeWidth={p.selected ? ".06" : ".045"}
            >
              <title>
                {p.label ?? (p.gapBefore
                  ? "Observed position after an unobserved gap"
                  : "Observed position")}
              </title>
            </circle>
          )}
        </g>
      ))}
      {layout.cameras.map((original) => {
        const c: Camera =
          preview?.id === original.id ? { ...original, ...preview.change } : original;
        const active = selected === c.id;
        const width = c.name.length * 0.3 * 0.56 + 0.18;
        return (
          <g key={"label-" + c.id} pointerEvents="none">
            <rect
              x={c.position_m[0] - width / 2}
              y={-c.position_m[1] + 0.24}
              width={width}
              height=".4"
              rx=".08"
              fill={active ? "#5b4fe8" : "#ffffff"}
              stroke={active ? "#5b4fe8" : "#cbd0e8"}
              strokeWidth=".02"
            />
            <text
              x={c.position_m[0]}
              y={-c.position_m[1] + 0.52}
              textAnchor="middle"
              fontSize=".26"
              fontWeight="600"
              fill={active ? "#fff" : "#3a3f63"}
            >
              {c.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
