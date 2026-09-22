import { test, expect } from "@playwright/test";
import { extrapolateExitPath, samplePersonTrack } from "../src/motionTracking";
import { activityModelName } from "@twinforge/spatial-view/Scene3D";

const point = (t_seconds: number, foot_x_norm = .5) => ({
  t_seconds, foot_x_norm, foot_y_norm: .7, confidence: .8,
});

test("3D classifications select distinct scene models", () => {
  expect(activityModelName("delivery")).toBe("delivery-worker");
  expect(activityModelName("person")).toBe("unidentified-person");
  expect(activityModelName("face_covering")).toBe("face-covering-person");
  expect(activityModelName("weapon")).toBe("possible-weapon-person");
  expect(activityModelName("intrusion")).toBe("possible-intrusion-person");
  expect(activityModelName("package")).toBe("package");
  expect(activityModelName("animal")).toBe("animal");
  expect(activityModelName("vehicle")).toBe("vehicle");
  expect(activityModelName("unknown")).toBe("unclear-activity");
  expect(activityModelName("none")).toBe("no-relevant-activity");
});

test("a person has no position before entry or after detection expires", () => {
  const points = [point(1), point(1.2, .6)];
  expect(samplePersonTrack([], 0).state).toBe("before");
  expect(samplePersonTrack(points, .9).state).toBe("before");
  expect(samplePersonTrack(points, 1.1)).toMatchObject({ state: "visible", footX: .55 });
  expect(samplePersonTrack(points, 1.5).state).toBe("visible");
  expect(samplePersonTrack(points, 1.66).state).toBe("after");
});

test("long detection gaps stay unknown and reentry uses the newly observed position", () => {
  const points = [point(0, .2), point(.2, .3), point(3, .8), point(3.2, .9)];
  expect(samplePersonTrack(points, .5)).toMatchObject({ state: "visible", footX: .3 });
  expect(samplePersonTrack(points, 1).state).toBe("gap");
  expect(samplePersonTrack(points, 2.9).state).toBe("gap");
  expect(samplePersonTrack(points, 3)).toMatchObject({ state: "visible", footX: .8 });
  expect(samplePersonTrack(points, .1)).toMatchObject({ state: "visible", footX: .25 });
});

test("an exit continuation crosses the camera range", () => {
  const camera = {
    position_m: [0, 0, 2.2], heading_degrees: 0, fov_degrees: 90, range_m: 5,
  } as any;
  const continuation = extrapolateExitPath(camera, [
    { xy: [1.2, 0], at: 10 },
    { xy: [2.1, 0.05], at: 11 },
  ]);
  expect(continuation.length).toBeGreaterThan(3);
  const [x, y] = continuation.at(-1)!;
  expect(Math.hypot(x, y)).toBeGreaterThan(5.7);
});

test("a side exit continuation crosses the angular field-of-view edge", () => {
  const camera = {
    position_m: [0, 0, 2.2], heading_degrees: 0, fov_degrees: 70, range_m: 7,
  } as any;
  const continuation = extrapolateExitPath(camera, [
    { xy: [2, 0.3], at: 4 },
    { xy: [2.05, 1.1], at: 5 },
  ]);
  const [x, y] = continuation.at(-1)!;
  expect(Math.abs(Math.atan2(y, x) * 180 / Math.PI)).toBeGreaterThan(40);
});
