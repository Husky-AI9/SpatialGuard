/**
 * People heatmap rendering shared by the 2D map and the 3D scene.
 *
 * The grid comes from the server already normalised to 0..1, row-major from the
 * minimum y upward, in metres. Both views draw the same canvas: its top row is
 * the grid's maximum y, which matches SVG (y down) and a floor texture.
 */
export type HeatGrid = {
  origin_xy_m: [number, number];
  cell_m: number;
  columns: number;
  rows: number;
  values: number[];
};

/** Blue for a few sightings, through yellow and orange, to red for the busiest spots. */
const STOPS: [number, [number, number, number]][] = [
  [0.0, [47, 91, 255]],
  [0.3, [66, 170, 255]],
  [0.5, [255, 214, 64]],
  [0.72, [255, 138, 31]],
  [1.0, [229, 50, 45]],
];
/** Below this share of the peak the ground stays clear, so quiet areas read as empty. */
export const HEAT_FLOOR = 0.04;

export function heatColor(value: number): [number, number, number, number] {
  if (value < HEAT_FLOOR) return [0, 0, 0, 0];
  const v = Math.min(1, value);
  let i = 1;
  while (i < STOPS.length - 1 && v > STOPS[i][0]) i++;
  const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
  const t = (v - a) / (b - a || 1);
  const rgb = ca.map((c, k) => Math.round(c + (cb[k] - c) * t)) as [number, number, number];
  // Fade in from the floor so blobs and camera-view estimates have soft
  // outlines rather than a hard step where the ground turns clear.
  const fade = Math.min(1, (v - HEAT_FLOOR) / 0.08);
  const alpha = Math.min(0.82, 0.18 + v * 1.4) * fade * fade * (3 - 2 * fade);
  return [...rgb, Math.round(alpha * 255)];
}

export const HEAT_LEGEND = `linear-gradient(to top, ${STOPS.map(([at, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${at * 100}%`).join(", ")})`;

export function heatCanvas(grid: HeatGrid): HTMLCanvasElement | null {
  if (!grid.values.length || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = grid.columns;
  canvas.height = grid.rows;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(grid.columns, grid.rows);
  for (let row = 0; row < grid.rows; row++) {
    const target = grid.rows - 1 - row; // top of the canvas is the maximum y
    for (let column = 0; column < grid.columns; column++) {
      const [r, g, b, a] = heatColor(grid.values[row * grid.columns + column]);
      const at = (target * grid.columns + column) * 4;
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = a;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Metre-space rectangle the grid covers: [minX, minY, width, height]. */
export function heatExtent(grid: HeatGrid): [number, number, number, number] {
  return [grid.origin_xy_m[0], grid.origin_xy_m[1], grid.columns * grid.cell_m, grid.rows * grid.cell_m];
}
