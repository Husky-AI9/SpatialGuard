import type { Camera } from "../../../../packages/sdk-typescript";

type GroundPoint = { t_seconds: number; foot_x_norm: number; foot_y_norm: number; confidence: number };
export type ProjectedSample = { xy: [number, number]; at: number };
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

const angleDifference = (left: number, right: number) => {
  let difference = left - right;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
};

/** Continue the final stabilized direction until it leaves the camera footprint. */
export function extrapolateExitPath(
  camera: Camera,
  history: ProjectedSample[],
): [number, number][] {
  if (history.length < 2) return [];
  const last = history[history.length - 1];
  let reference = history[0];
  for (let index = history.length - 2; index >= 0; index--) {
    reference = history[index];
    if (last.at - reference.at >= 0.8) break;
  }
  let dx = last.xy[0] - reference.xy[0];
  let dy = last.xy[1] - reference.xy[1];
  let magnitude = Math.hypot(dx, dy);
  const radialX = last.xy[0] - camera.position_m[0];
  const radialY = last.xy[1] - camera.position_m[1];
  const radialMagnitude = Math.hypot(radialX, radialY);
  if (magnitude < 0.12) {
    if (radialMagnitude < 0.01) return [];
    dx = radialX;
    dy = radialY;
    magnitude = radialMagnitude;
  }
  dx /= magnitude;
  dy /= magnitude;

  const heading = camera.heading_degrees * Math.PI / 180;
  const halfFov = camera.fov_degrees * Math.PI / 360;
  const isOutside = ([x, y]: [number, number]) => {
    const fromCameraX = x - camera.position_m[0];
    const fromCameraY = y - camera.position_m[1];
    const distance = Math.hypot(fromCameraX, fromCameraY);
    const angle = Math.atan2(fromCameraY, fromCameraX);
    return distance >= camera.range_m + 0.75 ||
      Math.abs(angleDifference(angle, heading)) >= halfFov + 5 * Math.PI / 180;
  };

  const result: [number, number][] = [];
  for (let distance = 0.65; distance <= Math.max(5.2, camera.range_m * 1.45); distance += 0.65) {
    const point: [number, number] = [last.xy[0] + dx * distance, last.xy[1] + dy * distance];
    result.push(point);
    if (isOutside(point)) return result;
  }
  if (radialMagnitude > 0.01) {
    const targetDistance = camera.range_m + 0.9;
    result.push([
      camera.position_m[0] + radialX / radialMagnitude * targetDistance,
      camera.position_m[1] + radialY / radialMagnitude * targetDistance,
    ]);
  }
  return result;
}
