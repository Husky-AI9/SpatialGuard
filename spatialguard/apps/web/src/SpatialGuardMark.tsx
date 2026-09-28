/**
 * Pathlight's mark: a "P" drawn as a heatmap grid, hot at the top and cooling
 * to purple, from the Pathlight logo. Cells are 9 x 8 on an 11.5 x 10 pitch.
 */
const LIGHT = "#E4E2FB";
export const PATHLIGHT_GRID: string[][] = [
  ["#F2613F", "#F2613F", "#F2613F", LIGHT],
  ["#FF8A4C", LIGHT, LIGHT, "#FF8A4C"],
  ["#FFB547", LIGHT, LIGHT, "#FFB547"],
  ["#FFD27A", "#FFD27A", "#FFD27A", LIGHT],
  ["#9E8CF5", LIGHT, LIGHT, LIGHT],
  ["#6D5DF5", LIGHT, LIGHT, LIGHT],
];

/** The grid mark alone; `size` is its height (it is 3:4 wide). */
export default function SpatialGuardMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="pl-mark" width={(size * 43.5) / 58} height={size} viewBox="0 0 43.5 58" aria-hidden="true">
      {PATHLIGHT_GRID.flatMap((row, r) =>
        row.map((fill, c) => <rect key={`${r}-${c}`} x={c * 11.5} y={r * 10} width="9" height="8" rx="2.2" fill={fill} />),
      )}
    </svg>
  );
}

/** The wordmark, set in Sora like the logo. */
export function PathlightWordmark({ className = "" }: { className?: string }) {
  return <span className={`pl-wordmark ${className}`.trim()}>Pathlight</span>;
}
