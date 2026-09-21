import TopDownPerson, { type ActivityKind } from "@twinforge/spatial-view/TopDownPerson";
import type { Marker } from "@twinforge/spatial-view/Map2D";
import type { components } from "./generated";

type Classification = components["schemas"]["IncidentClassification"];
type Presentation = { kind: ActivityKind; label: string; review: "routine" | "review" | "urgent"; person: boolean };
export const activities: Record<Classification["label"], Presentation> = {
  delivery_activity: { kind: "delivery", label: "Delivery worker", review: "routine", person: true },
  unidentified_person: { kind: "person", label: "Unidentified person", review: "review", person: true },
  face_covering_visible: { kind: "face_covering", label: "Face covering visible", review: "review", person: true },
  possible_weapon_visible: { kind: "weapon", label: "Possible weapon", review: "urgent", person: true },
  possible_unauthorized_entry: { kind: "intrusion", label: "Possible intrusion", review: "urgent", person: true },
  package_visible: { kind: "package", label: "Package visible", review: "routine", person: false },
  animal_visible: { kind: "animal", label: "Animal detected", review: "routine", person: false },
  vehicle_visible: { kind: "vehicle", label: "Vehicle detected", review: "routine", person: false },
  unclear: { kind: "unknown", label: "Activity unclear", review: "review", person: false },
  no_relevant_activity: { kind: "none", label: "No relevant activity", review: "review", person: false },
};

export type ActorPresentation = Pick<Marker, "actorKind" | "actorLabel" | "reviewLevel">;
export const DEFAULT_ACTOR: ActorPresentation = {
  actorKind: "person", actorLabel: "Person · not classified", reviewLevel: "review",
};
export function actorFromClassification(classification: Classification | null): ActorPresentation {
  if (!classification) return DEFAULT_ACTOR;
  const activity = activities[classification.label];
  // The current detector supplies person coordinates only. An event-level animal,
  // package or vehicle result cannot locate that object at the person's feet.
  if (!activity.person) return DEFAULT_ACTOR;
  return { actorKind: activity.kind, actorLabel: activity.label, reviewLevel: activity.review };
}

export function ActivityIcon({ classification }: { classification: Classification }) {
  const activity = activities[classification.label];
  return <svg className="classification-icon" viewBox="-4 -4 72 72" role="img" aria-label={activity.label}>
    <TopDownPerson kind={activity.kind} />
  </svg>;
}
