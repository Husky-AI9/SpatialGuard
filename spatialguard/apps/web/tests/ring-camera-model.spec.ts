import { expect, test } from "@playwright/test";
import * as THREE from "three";
import { ringCameraModel, type RingHardware } from "../src/ringCameraModels";

for (const kind of ["video_doorbell", "stick_up_cam"] as RingHardware[]) {
  test(`${kind} stays at hardware scale and attached when aimed along either wall face`, () => {
    for (const angle of [-80, -35, 0, 35, 80]) {
      const model = ringCameraModel(kind, "camera-a", true, angle, { normal: [1, 0], tangent: [0, 1] });
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      // Canonical +X is out of this wall. No part can be behind the wall
      // surface, nor may the mount float in front of it.
      expect(box.min.x).toBeCloseTo(0, 6);
      expect(box.max.x).toBeLessThan(.12);
      expect(box.max.y - box.min.y).toBeLessThan(.14);
      expect(box.max.z - box.min.z).toBeLessThan(.15);
      expect(model.getObjectByName(kind === "video_doorbell" ? "doorbell-button" : "swivel-joint")).toBeDefined();
      expect(model.getObjectByName("lens-glass")).toBeDefined();
      model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          expect(object.userData.id).toBe("camera-a");
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => m.dispose());
        }
      });
    }
  });
}
