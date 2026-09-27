import type { SVGProps } from "react";

/**
 * SpatialGuard's camera symbol: a ring with a centre dot, the same mark used
 * for cameras on the floor-plan map and the app icon. Drop-in for a lucide
 * icon: it takes `size` and draws in `currentColor`.
 */
export default function CameraMark({
  size = 24,
  strokeWidth = 2.6,
  ...props
}: { size?: number | string; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" />
    </svg>
  );
}
