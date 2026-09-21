import type { Layout } from "../sdk-typescript";

type XY = [number, number];
export type WallSpan = { a: XY; b: XY; bottom: number; top: number };
export const WALL_THICKNESS_M = 0.1;

// Split at shared vertices and portal ends, then deduplicate shared walls.
// Door head height is illustrative: the layout contract has no measured door heights.
export function wallSpans(layout: Layout, cutaway: boolean, floorId?: string): WallSpan[] {
  const walls = new Map<string, WallSpan>();
  const rooms = layout.rooms.filter(r => floorId === undefined || r.floor_id === floorId);
  const vertices = rooms.flatMap((r) => r.polygon_xy_m);
  for (const room of rooms) {
    if (room.height_m < 0.3) continue; // Outdoor slab, not an enclosed room.
    const elevation =
      layout.floors.find((f) => f.id === room.floor_id)?.elevation_m ?? 0;
    const top = cutaway ? Math.min(room.height_m, 1.05) : room.height_m;
    const portals = layout.portals.filter(
      (p) => p.from_room_id === room.id || p.to_room_id === room.id,
    );
    room.polygon_xy_m.forEach((a, i) => {
      const b = room.polygon_xy_m[(i + 1) % room.polygon_xy_m.length];
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      if (length < 0.001) return;
      const along = (p: XY) =>
        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length;
      const onLine = (p: XY) =>
        Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length < 0.001;
      const openings = portals
        .filter((p) => p.segment_xy_m.every(onLine))
        .map((p) => p.segment_xy_m.map(along).sort((u, v) => u - v));
      const breaks = [
        0,
        length,
        ...vertices.filter(onLine).map(along),
        ...openings.flat(),
      ]
        .filter((v) => v >= 0 && v <= length)
        .sort((u, v) => u - v)
        .filter((v, j, all) => j === 0 || v - all[j - 1] > 0.001);
      for (let j = 1; j < breaks.length; j++) {
        const start = breaks[j - 1],
          end = breaks[j],
          mid = (start + end) / 2;
        const opening = openings.some(([u, v]) => mid > u && mid < v);
        const bottom = opening ? Math.min(2.1, room.height_m) : 0;
        if (bottom >= top) continue;
        const point = (t: number): XY => [
          a[0] + (dx * t) / length,
          a[1] + (dy * t) / length,
        ];
        const aa = point(start),
          bb = point(end);
        const key =
          [aa, bb]
            .map((p) => p.map((v) => v.toFixed(4)).join(","))
            .sort()
            .join(";") + `:${elevation}:${bottom}`;
        const previous = walls.get(key);
        walls.set(key, {
          a: aa,
          b: bb,
          bottom: elevation + bottom,
          top: Math.max(elevation + top, previous?.top ?? -Infinity),
        });
      }
    });
  }
  return [...walls.values()];
}

/** The building's own extent, ignoring where cameras look. Used to sit the
 *  plan on a plot of ground rather than floating it in space. */
export function footprint(layout: Layout, margin = 2.4) {
  const points = [...layout.rooms, ...layout.zones].flatMap((r) => r.polygon_xy_m);
  if (!points.length) return null;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - margin,
    y = Math.min(...ys) - margin;
  return {
    x,
    y,
    width: Math.max(...xs) - x + margin,
    height: Math.max(...ys) - y + margin,
  };
}

export function bounds(layout: Layout, groundMargin = 2.4, padding = 1.2) {
  const points = [
    ...layout.rooms,
    ...layout.zones.filter((zone) => zone.purpose === "outdoor"),
  ].flatMap((r) => r.polygon_xy_m);
  if (points.length)
    // Include where each camera is aimed, not just where it sits, so a coverage
    // wedge is never clipped by the edge of the view.
    points.push(
      ...layout.cameras.flatMap((c): XY[] => {
        // Sample the complete arc, rather than only its two corners and
        // center, so wide or diagonal fields of view remain on the ground.
        const reach = Array.from({ length: 25 }, (_, index) =>
          ((c.heading_degrees - c.fov_degrees / 2 + c.fov_degrees * index / 24)
            * Math.PI) / 180,
        );
        return [
          [c.position_m[0], c.position_m[1]],
          ...reach.map(
            (angle): XY => [
              c.position_m[0] + Math.cos(angle) * c.range_m,
              c.position_m[1] + Math.sin(angle) * c.range_m,
            ],
          ),
        ];
      }),
    );
  const plot = footprint(layout, groundMargin);
  if (points.length && plot)
    // The plot of ground is part of the drawing, so keep it in view.
    points.push(
      [plot.x, plot.y],
      [plot.x + plot.width, plot.y + plot.height],
    );
  if (layout.floor_plan) {
    const f = layout.floor_plan;
    points.push(f.origin_xy_m, [
      f.origin_xy_m[0] + f.width_m,
      f.origin_xy_m[1] + f.height_m,
    ]);
  }
  if (!points.length) return [-1, -1, 14, 11];
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - padding,
    y = Math.min(...ys) - padding;
  return [x, y, Math.max(...xs) - x + padding, Math.max(...ys) - y + padding];
}
