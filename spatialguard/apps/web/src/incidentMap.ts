import type { Camera } from "../../../../packages/sdk-typescript";
import type { EvidenceLink, Marker } from "@twinforge/spatial-view/Map2D";
import type { components } from "./generated";

type Incident = components["schemas"]["Incident"];

/**
 * Map markers for an incident at the selected step. Shared by the web app and
 * the native app's embedded map so both show the same evidence.
 */
export function incidentMarkers(incident: Incident, cameras: Camera[], step: number): Marker[] {
  // An observation with no coordinate is a gap, not a position. Carry that
  // forward so the map can draw the unobserved leg instead of a clean line.
  let unobserved = false;
  return incident.observations.flatMap((o, i) => {
    if (o.location.kind === "unknown" && incident.evidence_mode === "live") {
      const camera = cameras.find((item) => item.id === o.source_id);
      if (!camera) return [];
      return [{
        id: o.observation_id,
        xy: [camera.position_m[0], camera.position_m[1]] as [number, number],
        selected: i === step,
        evidenceNode: true,
        label: `Activity observed by ${camera.name}; person position unknown`,
      } satisfies Marker];
    }
    if (o.location.kind !== "floor_point") {
      unobserved = true;
      return [];
    }
    const marker: Marker = {
      id: o.observation_id,
      xy: o.location.xy_m as [number, number],
      selected: i === step,
      gapBefore: unobserved,
    };
    unobserved = false;
    return [marker];
  });
}

/** Possible continuations between live camera observations. */
export function incidentLinks(incident: Incident): EvidenceLink[] {
  if (incident.evidence_mode !== "live") return [];
  return incident.associations.map((association, index) => ({
    id: `evidence-link-${index}-${association.to_observation_id}`,
    fromMarkerId: association.from_observation_id,
    toMarkerId: association.to_observation_id,
    gapSeconds: association.unobserved_gap_seconds,
    label: association.reason,
  }));
}
