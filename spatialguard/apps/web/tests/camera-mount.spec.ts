import { test, expect } from "@playwright/test";
import fs from "node:fs";
import * as THREE from "three";
import type { Layout } from "../../../../packages/sdk-typescript";
import { cameraModel, nearestWallMount, worldToViewer } from "@twinforge/spatial-view/Scene3D";
import { wallSpans, WALL_THICKNESS_M } from "@twinforge/spatial-view/geometry";

const fixture = () => JSON.parse(fs.readFileSync("../../../fixtures/synthetic-home/layout.json", "utf8")) as Layout;

test("front and hallway cameras attach to solid faces, not outdoor slab boundaries", () => {
  const layout = fixture();
  const original = JSON.stringify(layout);
  const front = nearestWallMount(layout, [8.3, 6], 48, "floor_0")!;
  // The approach ends at x=11, y=5.5, but has no walls. The camera must
  // return to the house and sit on its north/east wall face.
  expect(front.point[0]).toBeLessThanOrEqual(8.05);
  expect(front.point[1]).toBeLessThanOrEqual(5.55);
  expect(wallSpans(layout, true)).toContainEqual(front.wall);
  const hall = nearestWallMount(layout, [-.25, 3.8], 254, "floor_0")!;
  expect(hall.point[0]).toBeCloseTo(-.05);
  expect(hall.point[1]).toBeCloseTo(3.8);
  expect(hall.normal[0]).toBeCloseTo(-1);
  expect(hall.normal[1]).toBeCloseTo(0);
  expect(JSON.stringify(layout)).toBe(original);
});

test("a camera placed in a doorway moves onto the adjacent solid wall", () => {
  const layout = fixture();
  const mount = nearestWallMount(layout, [8.1, 4.7], 0, "floor_0")!;
  expect(mount.point[0]).toBeCloseTo(8.05);
  expect(mount.point[1]).toBeGreaterThan(5.2 + .07);
  expect(mount.point[1]).toBeLessThan(5.5 - .07);
});

test("mounts use their camera floor and never invent a wall for an outdoor-only plan", () => {
  const layout = fixture();
  const outdoor = layout.rooms.find(r => r.id === "room_approach")!;
  const upper = { ...layout.rooms[0], id: "upper-room", floor_id: "upper" };
  layout.floors.push({ id: "upper", name: "Upper floor", elevation_m: 3 });
  layout.rooms = [outdoor, upper];
  expect(nearestWallMount(layout, [1, .1], 90, "floor_0")).toBeNull();
  const mount = nearestWallMount(layout, [1, .1], 90, "upper")!;
  expect(mount.wall.bottom).toBe(3);
  expect(mount.wall.top).toBe(4.05);
});

test("camera plates remain flush and fully supported on straight, reversed and diagonal walls", () => {
  for (const angle of [0, 37, 90, 180, 254]) {
    for (const reversed of [false, true]) {
      const layout = fixture();
      const radians = angle * Math.PI / 180;
      const rotate = ([x, y]: number[]): [number, number] => [
        x * Math.cos(radians) - y * Math.sin(radians),
        x * Math.sin(radians) + y * Math.cos(radians),
      ];
      layout.rooms = [{ ...layout.rooms[0], polygon_xy_m: [[0, 0], [5, 0], [5, 4], [0, 4]].map(rotate) }];
      if (reversed) layout.rooms[0].polygon_xy_m.reverse();
      layout.portals = [];
      // Near a corner: the whole plate must fit on the wall, not overhang it.
      const mount = nearestWallMount(layout, rotate([4.99, -.2]), angle - 90, "floor_0")!;
      const model = cameraModel("test-camera", false, angle - 90, mount);
      model.position.copy(worldToViewer([...mount.point, .82]));
      model.updateMatrixWorld(true);
      const plate = model.getObjectByName("mount-plate") as THREE.Mesh<THREE.BoxGeometry>;
      const vertices = plate.geometry.getAttribute("position");
      const outward = worldToViewer([...mount.normal, 0]);
      const tangent = worldToViewer([...mount.tangent, 0]);
      const wallStart = worldToViewer([...mount.wall.a, 0]);
      const wallLength = Math.hypot(mount.wall.b[0] - mount.wall.a[0], mount.wall.b[1] - mount.wall.a[1]);
      const distances: number[] = [];
      for (let i = 0; i < vertices.count; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(vertices, i);
        plate.localToWorld(vertex);
        const fromWall = vertex.clone().sub(wallStart);
        distances.push(fromWall.dot(outward));
        expect(fromWall.dot(tangent)).toBeGreaterThan(0);
        expect(fromWall.dot(tangent)).toBeLessThan(wallLength);
        expect(vertex.y).toBeGreaterThan(mount.wall.bottom);
        expect(vertex.y).toBeLessThan(mount.wall.top);
      }
      // Back face touches the rendered wall face; front face is outside it.
      expect(Math.min(...distances)).toBeCloseTo(WALL_THICKNESS_M / 2, 6);
      expect(Math.max(...distances)).toBeGreaterThan(WALL_THICKNESS_M / 2);
      model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => m.dispose());
        }
      });
    }
  }
});
