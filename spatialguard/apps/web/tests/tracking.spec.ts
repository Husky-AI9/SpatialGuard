import { test, expect } from "@playwright/test";
import { samplePersonTrack } from "../src/motionTracking";
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
