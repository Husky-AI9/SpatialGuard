/** Presentation-only label placement in SVG coordinates; never changes map data. */
export type LabelBox = { x: number; y: number; width: number; height: number };
export type MapLabel = {
  id: string;
  name: string;
  kind: "camera" | "actor";
  x: number;
  y: number;
  selected?: boolean;
  preferred?: [number, number];
};
export type PlacedLabel = MapLabel & { box: LabelBox; text: string };

const overlap = (a: LabelBox, b: LabelBox) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

export function placeMapLabels(labels: MapLabel[], view: LabelBox, unit: number, obstacles: LabelBox[]): PlacedLabel[] {
  const occupied = [...obstacles];
  const ordered = [...labels].sort((a, b) => Number(b.selected) - Number(a.selected) ||
    Number(b.kind === "actor") - Number(a.kind === "actor") || a.id.localeCompare(b.id));
  return ordered.filter(label => label.x >= view.x && label.x <= view.x + view.width &&
    label.y >= view.y && label.y <= view.y + view.height).map(label => {
    const maxChars = Math.max(5, Math.min(24, Math.floor((view.width / unit - 28) / 7)));
    const text = label.name.length > maxChars ? label.name.slice(0, maxChars - 1) + "…" : label.name;
    const width = (text.length * 7 + (label.kind === "actor" ? 18 : 8)) * unit;
    const height = 22 * unit;
    const directions: [number, number][] = [label.preferred ?? [1, -1], [1, -1], [-1, -1],
      [1, 1], [-1, 1], [0, -1], [0, 1], [1, 0], [-1, 0]];
    let best: LabelBox = { x: label.x, y: label.y, width, height };
    let bestScore = Infinity;
    for (const distance of [14, 32, 52, 76]) {
      for (let index = 0; index < directions.length; index++) {
        const [dx, dy] = directions[index];
        const gap = distance * unit;
        const rawX = label.x + dx * gap - (dx < 0 ? width : dx === 0 ? width / 2 : 0);
        const rawY = label.y + dy * gap - (dy < 0 ? height : dy === 0 ? height / 2 : 0);
        const box = {
          x: Math.max(view.x + 4 * unit, Math.min(view.x + view.width - width - 4 * unit, rawX)),
          y: Math.max(view.y + 4 * unit, Math.min(view.y + view.height - height - 4 * unit, rawY)),
          width, height,
        };
        const score = occupied.reduce((sum, other) => sum + overlap(box, other) / (unit * unit) * 1000, 0) +
          distance + index * .5 + (Math.abs(box.x - rawX) + Math.abs(box.y - rawY)) / unit;
        if (score < bestScore) { bestScore = score; best = box; }
      }
    }
    occupied.push({x: best.x - 3 * unit, y: best.y - 3 * unit,
      width: best.width + 6 * unit, height: best.height + 6 * unit});
    return {...label, box: best, text};
  });
}
