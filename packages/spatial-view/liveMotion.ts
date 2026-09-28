/**
 * Which cameras detected motion just now, for the pulsing motion waves.
 *
 * Shared by the web app and the native app (no React import, so each app wraps
 * it in its own hook). A camera is active for {@link MOTION_HOLD_MS} after a
 * sighting, or after its incident first reaches the screen: a Ring event can
 * take a few seconds to be processed and should still pulse when it arrives.
 */

export type MotionIncident = {
  id: string;
  evidence_mode: string;
  created_at: string;
  observations: { source_id: string; observed_at: string; category: string }[];
};

/** How long a camera keeps pulsing after it reports motion. */
export const MOTION_HOLD_MS = 30_000;
/** A visit recorded within this long counts as newly arrived activity. */
const FRESH_MS = 2 * 60_000;

/**
 * When each sighting really happened. Live incidents carry clock times; a
 * replay keeps its fixture times, so it is anchored to when it was recorded
 * (the same rule the heatmap uses).
 */
export function sightingTimes(incident: MotionIncident): [string, number][] {
  const seen = incident.observations.filter((o) => o.category !== "coverage_gap");
  if (!seen.length) return [];
  if (incident.evidence_mode === "live")
    return seen.map((o) => [o.source_id, Date.parse(o.observed_at)]);
  const created = Date.parse(incident.created_at);
  const last = Math.max(...seen.map((o) => Date.parse(o.observed_at)));
  return seen.map((o) => [o.source_id, created + Date.parse(o.observed_at) - last]);
}

export class MotionTracker {
  private known: Set<string> | null = null;
  private until = new Map<string, number>();

  reset() {
    this.known = null;
    this.until.clear();
  }

  /** Active camera ids, and how long until the next one stops (null: none active). */
  update(incidents: MotionIncident[], now = Date.now()): { active: string[]; next: number | null } {
    const first = this.known === null;
    const seen = this.known ?? new Set<string>();
    for (const incident of incidents) {
      // "Arrived" means recorded just now, not merely new to this list: apps
      // start with an empty list and then load older visits, which must not
      // make every camera pulse when the home screen opens.
      const created = Date.parse(incident.created_at);
      const fresh = Number.isFinite(created) && now - created <= FRESH_MS;
      const arrived = !first && !seen.has(incident.id) && fresh;
      seen.add(incident.id);
      for (const [camera, at] of sightingTimes(incident)) {
        const end = Math.max(Number.isFinite(at) ? at + MOTION_HOLD_MS : 0, arrived ? now + MOTION_HOLD_MS : 0);
        if (end > now && end > (this.until.get(camera) ?? 0)) this.until.set(camera, end);
      }
    }
    this.known = seen;
    for (const [camera, end] of this.until) if (end <= now) this.until.delete(camera);
    const active = [...this.until.keys()].sort();
    return { active, next: active.length ? Math.min(...this.until.values()) - now : null };
  }
}
