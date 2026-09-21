import type { Camera } from "../../../../packages/sdk-typescript";

type GroundPoint = { t_seconds: number; foot_x_norm: number; foot_y_norm: number; confidence: number };
export type TrackSample =
  | { state: "visible"; footX: number; footY: number; confidence: number }
  | { state: "before" | "gap" | "after" };

/** A short detector grace period is allowed; long gaps and exits have no position. */
export function samplePersonTrack(points: GroundPoint[], at: number): TrackSample {
  if (!points.length || at < points[0].t_seconds) return { state: "before" };
  const last = points[points.length - 1];
  if (at > last.t_seconds + 0.45) return { state: "after" };
  let right = points.findIndex(point => point.t_seconds >= at);
  if (right < 0) right = points.length - 1;
  const after = points[right], before = points[Math.max(0, right - 1)];
  const span = after.t_seconds - before.t_seconds;
  if (span > 1.25 && at < after.t_seconds) {
    if (at > before.t_seconds + 0.45) return { state: "gap" };
    return { state: "visible", footX: before.foot_x_norm, footY: before.foot_y_norm, confidence: before.confidence };
  }
  const ratio = span > 1.25 ? 1 : Math.max(0, Math.min(1, (at - before.t_seconds) / Math.max(.001, span)));
  return {
    state: "visible",
    footX: before.foot_x_norm + (after.foot_x_norm - before.foot_x_norm) * ratio,
    footY: before.foot_y_norm + (after.foot_y_norm - before.foot_y_norm) * ratio,
    confidence: Math.min(before.confidence, after.confidence),
  };
}

/** Project a person's ground-contact point without using unstable box height. */
export function projectGroundPoint(
  camera: Camera,
  footX: number,
  footY: number,
): [number, number] {
  const x = Math.max(0, Math.min(1, footX));
  const y = Math.max(0.35, Math.min(1, footY));
  const bearing =
    ((camera.heading_degrees + (0.5 - x) * camera.fov_degrees) * Math.PI) / 180;
  const depth = (1 - y) / 0.65;
  const near = Math.min(0.75, camera.range_m * 0.3);
  const distance = near + Math.pow(depth, 1.7) * Math.max(0, camera.range_m - near);
  return [
    camera.position_m[0] + Math.cos(bearing) * distance,
    camera.position_m[1] + Math.sin(bearing) * distance,
  ];
}

/** Reject map jumps faster than a walking person can plausibly move. */
export function limitMovement(
  previous: [number, number] | null,
  target: [number, number],
  elapsedSeconds: number,
): [number, number] {
  if (!previous || elapsedSeconds <= 0 || elapsedSeconds > 1.5) return target;
  const dx = target[0] - previous[0],
    dy = target[1] - previous[1],
    distance = Math.hypot(dx, dy),
    maximum = Math.max(0.08, elapsedSeconds * 1.8);
  if (distance <= maximum) return target;
  const ratio = maximum / distance;
  return [previous[0] + dx * ratio, previous[1] + dy * ratio];
}
