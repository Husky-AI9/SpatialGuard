import type { Camera } from '../../../../packages/sdk-typescript';
import type { Marker } from '@twinforge/spatial-view/Map2D';
import type { components } from './generated';
import { actorFromClassification } from './activityPresentation';
import { limitMovement, projectGroundPoint, samplePersonTrack } from './motionTracking';

type Track = components['schemas']['TestVideoTrack'];
type Classification = components['schemas']['IncidentClassification'];

/** Rebuild up to the playhead, so pause/seek/replay never append stale or future paths. */
export function incidentMovement(track: Track, camera: Camera, at: number, classification: Classification | null): Marker[] {
  const actor = actorFromClassification(classification);
  const points = track.points.filter(point => point.t_seconds <= at);
  const current = samplePersonTrack(track.points, at);
  if (current.state === 'visible') points.push({t_seconds: at, foot_x_norm: current.footX,
    foot_y_norm: current.footY, confidence: current.confidence});
  let previous: {xy: [number, number]; at: number} | null = null;
  return points.map((point, index) => {
    const gap = !!previous && point.t_seconds - previous.at > 1.25;
    const target = projectGroundPoint(camera, point.foot_x_norm, point.foot_y_norm);
    const xy = limitMovement(gap ? null : previous?.xy ?? null, target, previous ? point.t_seconds - previous.at : 0);
    const headingDegrees = previous && !gap ? Math.atan2(xy[1] - previous.xy[1], xy[0] - previous.xy[0]) * 180 / Math.PI : camera.heading_degrees;
    previous = {xy, at: point.t_seconds};
    return {id: `recorded-${track.video_id}-${index}`, xy, approximate: true, gapBefore: gap,
      selected: index === points.length - 1 && current.state === 'visible', headingDegrees,
      uncertainty_m: 0.55 + (1 - point.confidence) * .75, ...actor,
      label: 'Estimated movement from recording · no camera calibration'};
  });
}
