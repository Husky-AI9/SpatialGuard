import type { Camera } from "../sdk-typescript";

export type CameraChange = Partial<
  Pick<
    Camera,
    "name" | "position_m" | "heading_degrees" | "pitch_degrees" | "fov_degrees" | "range_m"
  >
>;
export const heading = (degrees: number) => ((degrees % 360) + 360) % 360;
export const snap = (value: number) =>
  Math.max(-10000, Math.min(10000, Math.round(value * 20) / 20));

// The coverage wedge is the camera's declared horizontal field of view on the floor.
// It ignores tilt, walls, and occlusion, so it shows intent rather than proven coverage.
export function coveragePath(camera: Camera) {
  const [cx, cy] = camera.position_m;
  const start = ((camera.heading_degrees - camera.fov_degrees / 2) * Math.PI) / 180;
  const end = ((camera.heading_degrees + camera.fov_degrees / 2) * Math.PI) / 180;
  const r = camera.range_m;
  const ax = cx + Math.cos(start) * r,
    ay = cy + Math.sin(start) * r,
    bx = cx + Math.cos(end) * r,
    by = cy + Math.sin(end) * r;
  // Y is inverted at the SVG boundary, so the sweep runs the other way.
  return `M ${cx} ${-cy} L ${ax} ${-ay} A ${r} ${r} 0 0 0 ${bx} ${-by} Z`;
}

// Aim handle sits at the tip of the cone, but never underneath the camera body.
export const aimDistance = (camera: Camera) => Math.max(0.95, camera.range_m);

export function aimPoint(camera: Camera): [number, number] {
  const angle = (camera.heading_degrees * Math.PI) / 180;
  const d = aimDistance(camera);
  return [camera.position_m[0] + Math.cos(angle) * d, camera.position_m[1] + Math.sin(angle) * d];
}

/**
 * The same outlined camera glyph used by the SpatialGuard landing page.
 *
 * Keep this as SVG rather than a product-specific hardware drawing: the map
 * marker communicates "camera" at a glance and stays consistent with the
 * landing page, camera cards, and native client.
 */
export default function CameraGlyph({
  camera,
  fill,
  scale = 1,
}: {
  camera: Camera;
  fill: string;
  scale?: number;
}) {
  const [cx, cy] = camera.position_m;
  return (
    <g
      transform={`translate(${cx} ${-cy}) rotate(${-heading(camera.heading_degrees)}) scale(${scale})`}
      pointerEvents="none"
    >
      <g transform="translate(-.3 -.31) scale(.025)">
        <path
          d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
          fill="none"
          stroke={fill}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx="12"
          cy="13"
          r="3"
          fill="none"
          stroke={fill}
          strokeWidth="2.1"
        />
      </g>
    </g>
  );
}
