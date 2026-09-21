import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { CameraModelFactory } from "@twinforge/spatial-view/Scene3D";

export type RingHardware = "video_doorbell" | "stick_up_cam";

const surface = (color: number, roughness = .5, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function part(group: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function lens(group: THREE.Group, y: number, z: number, radius: number) {
  part(group, "lens-bezel", new THREE.TorusGeometry(radius, .0015, 8, 24), surface(0x3d434c, .26, .6), 0, y, z);
  const glass = part(group, "lens-glass", new THREE.SphereGeometry(radius * .84, 20, 12),
    new THREE.MeshPhysicalMaterial({ color: 0x111f31, roughness: .08, metalness: .25, clearcoat: 1 }), 0, y, z);
  glass.scale.z = .25;
  part(group, "lens-reflection", new THREE.CircleGeometry(radius * .2, 12), surface(0x58778d, .18), -radius * .25, y + radius * .24, z + radius * .22);
}

function grille(group: THREE.Group, y: number, z: number, material: THREE.Material) {
  for (let row = 0; row < 3; row++) for (let column = 0; column < 7; column++) {
    part(group, "speaker-perforation", new THREE.CircleGeometry(.00065, 6), material,
      (column - 3) * .0035, y + row * .0025, z);
  }
}

/** Original procedural representations based on Ring product references, not
 * official CAD. Metres: Doorbell body .062 x .1265 x .028; Stick Up body
 * .060 x .097 x .060. The origin is the wall surface; local +Z faces out. */
export function ringCameraModel(
  kind: RingHardware, ...[id, active, headingDegrees, mount]: Parameters<CameraModelFactory>
) {
  const root = new THREE.Group();
  root.name = `ring-${kind}-${id}`;
  const white = surface(0xf1f2f2, .44);
  const black = surface(0x16191d, .3);
  const nickel = surface(0xb8bcc0, .42, .65);
  const accent = surface(active ? 0x5b4fe8 : 0x343b43, .4);
  const normalYaw = Math.atan2(mount.normal[0], -mount.normal[1]);
  root.rotation.y = normalYaw;
  const yaw = headingDegrees * Math.PI / 180;
  const relativeYaw = Math.atan2(Math.cos(yaw), -Math.sin(yaw)) - normalYaw;
  const body = new THREE.Group();
  body.name = "camera-housing";
  body.rotation.y = relativeYaw;

  if (kind === "video_doorbell") {
    const width = .062, height = .1265, depth = .028;
    const plateDepth = .003;
    // A solid wedge adapter fills the space behind an angled doorbell. Its
    // back is flush with the wall, while its front follows the camera heading.
    body.position.z = plateDepth + Math.abs(Math.sin(relativeYaw)) * width / 2
      + Math.abs(Math.cos(relativeYaw)) * depth / 2 + .001;
    body.updateMatrix();
    const rear = [[-width / 2, -height / 2], [width / 2, -height / 2],
      [width / 2, height / 2], [-width / 2, height / 2]]
      .map(([x, y]) => new THREE.Vector3(x, y, -depth / 2).applyMatrix4(body.matrix));
    const vertices = [...rear.map(p => [p.x, p.y, 0]), ...rear.map(p => p.toArray())].flat();
    const wedge = new THREE.BufferGeometry();
    wedge.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    wedge.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    wedge.computeVertexNormals();
    part(root, "mount-plate", wedge, accent);
    part(body, "doorbell-shell", new RoundedBoxGeometry(width, height, depth, 3, .008), nickel);
    part(body, "black-lens-panel", new RoundedBoxGeometry(.057, .054, .003, 3, .006), black, 0, .032, .013);
    lens(body, .036, .016, .010);
    part(body, "motion-sensor", new RoundedBoxGeometry(.019, .009, .002, 2, .003), surface(0x242a31, .2), 0, .015, .016);
    part(body, "button-ring", new THREE.TorusGeometry(.0132, .0016, 8, 32), surface(0x559fcc, .3, .3), 0, -.018, .015);
    part(body, "doorbell-button", new THREE.CylinderGeometry(.0115, .0115, .003, 32), nickel, 0, -.018, .015).rotation.x = Math.PI / 2;
    grille(body, -.047, .0143, black);
  } else {
    // The circular stand is rotated onto the wall. A short stem and ball joint
    // connect it to the upright body, rather than a horizontal bullet housing.
    const plate = part(root, "mount-plate", new THREE.CylinderGeometry(.03, .03, .006, 32), active ? accent : white, 0, -.025, .003);
    plate.rotation.x = Math.PI / 2;
    part(root, "mount-stem", new THREE.CylinderGeometry(.005, .006, .041, 16), white, 0, -.025, .025).rotation.x = Math.PI / 2;
    part(root, "swivel-joint", new THREE.SphereGeometry(.01, 16, 12), white, 0, -.025, .048);
    body.position.z = .073;
    part(body, "stick-up-shell", new THREE.CylinderGeometry(.03, .03, .097, 40), white);
    // Wrap the black optical panel around the cylinder's front surface.
    part(body, "black-lens-panel", new THREE.CylinderGeometry(.03025, .03025, .068, 24, 1, true, -.86, 1.72), black, 0, .01, 0);
    lens(body, .023, .0315, .0095);
    part(body, "infrared-sensor", new THREE.SphereGeometry(.006, 14, 10), surface(0x29343e, .2), 0, -.002, .0305).scale.z = .3;
    part(body, "status-light", new THREE.CircleGeometry(.0014, 12), surface(0x699cb8), 0, .040, .0307);
    grille(body, -.035, .0304, black);
    const seam = part(body, "battery-cover-seam", new THREE.TorusGeometry(.0298, .00065, 6, 40), surface(0xcbd0d3), 0, -.043, 0);
    seam.rotation.x = Math.PI / 2;
  }
  root.add(body);
  root.traverse(object => { if (object instanceof THREE.Mesh) object.userData.id = id; });
  return root;
}
