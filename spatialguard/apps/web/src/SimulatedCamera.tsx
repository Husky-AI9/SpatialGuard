/**
 * The picture shown for a demo-mode (simulated) camera: a café view with a
 * ticking on-screen clock, like a camera overlay, and a small SIM tag so it is
 * never mistaken for a Ring feed. Photos: Unsplash License (Nikita Pishchugin,
 * Linh Quach), cropped to a camera frame.
 */
import { useEffect, useState } from "react";
import seating from "./assets/sim/seating.jpg";
import windowBar from "./assets/sim/window-bar.jpg";

export const simulatedPreview = (name: string) => (/window/i.test(name) ? windowBar : seating);

const clock = (date: Date) =>
  `${date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "numeric" })} ${date.toLocaleTimeString(undefined, { hour12: false })}`;

export default function SimulatedCamera({ name, compact = false, className = "" }: {
  name: string; compact?: boolean; className?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (compact) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [compact]);
  return (
    <div className={`sim-camera${compact ? " sim-camera-compact" : ""} ${className}`} role="img"
      aria-label={`${name}: simulated camera view`}>
      <img src={simulatedPreview(name)} alt="" draggable={false} />
      {!compact && <span className="sim-camera-name">{name}</span>}
      {!compact && <span className="sim-camera-clock">{clock(now)}</span>}
      <span className="sim-camera-tag">SIM</span>
    </div>
  );
}
