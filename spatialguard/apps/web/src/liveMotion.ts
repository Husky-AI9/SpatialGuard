import { useEffect, useRef, useState } from "react";
import { MotionTracker, type MotionIncident } from "@twinforge/spatial-view/liveMotion";

/** Cameras that detected motion in the last few seconds (see MotionTracker). */
export function useLiveMotion(incidents: MotionIncident[], siteId: string | undefined): string[] {
  const tracker = useRef(new MotionTracker());
  const [active, setActive] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    tracker.current.reset();
    setActive([]);
  }, [siteId]);

  useEffect(() => {
    const { active: next, next: wait } = tracker.current.update(incidents);
    setActive((previous) => (previous.join() === next.join() ? previous : next));
    if (wait === null) return;
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(250, wait + 50));
    return () => clearTimeout(timer);
  }, [incidents, tick]);

  return active;
}
