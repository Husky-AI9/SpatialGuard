import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Layout } from "../sdk-typescript";
import { bounds, footprint, wallSpans, WALL_THICKNESS_M, type WallSpan } from "./geometry";
import type { EvidenceLink, Marker } from "./Map2D";
import { activityColor, type ActivityKind } from "./TopDownPerson";
export const worldToViewer = ([x, y, z]: number[]) =>
  new THREE.Vector3(x, z, -y);

type XY = [number, number];
type WallMount = { point: XY; tangent: XY; normal: XY; distance: number; wall: WallSpan };
export type CameraModelFactory = (
  id: string, active: boolean, headingDegrees: number,
  mount: Pick<WallMount, "normal" | "tangent">,
) => THREE.Group;
const MOUNT_PLATE_WIDTH = .14;
const MOUNT_PLATE_HEIGHT = .16;
const MOUNT_PLATE_DEPTH = .026;
// Leave room for both the plate and the swivelling housing at wall ends.
const MOUNT_EDGE_CLEARANCE = MOUNT_PLATE_WIDTH / 2 + WALL_THICKNESS_M / 2 + .01;

/** Project a plan camera onto a solid rendered wall face for the 3D presentation.
 * The stored TwinForge pose stays untouched; this only prevents cutaway cameras
 * from appearing suspended beside a wall. */
export function nearestWallMount(
  layout: Layout,
  position: XY,
  headingDegrees?: number,
  floorId?: string,
): WallMount | null {
  let best: WallMount | null = null;
  let bestScore = Infinity;
  const heading = headingDegrees === undefined
    ? null
    : [
        Math.cos(headingDegrees * Math.PI / 180),
        Math.sin(headingDegrees * Math.PI / 180),
      ] as XY;
  for (const wall of wallSpans(layout, true, floorId)) {
    const { a, b } = wall;
    const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    const length = Math.sqrt(length2);
    if (length < MOUNT_EDGE_CLEARANCE * 2 || wall.top - wall.bottom < MOUNT_PLATE_HEIGHT + .04) continue;
    const inset = MOUNT_EDGE_CLEARANCE / length;
    const t = Math.max(inset, Math.min(1 - inset,
      ((position[0] - a[0]) * dx + (position[1] - a[1]) * dy) / length2));
    const center: XY = [a[0] + dx * t, a[1] + dy * t];
    const tangent: XY = [dx / length, dy / length];
    const firstNormal: XY = [-tangent[1], tangent[0]];
    const side = heading
      ? heading[0] * firstNormal[0] + heading[1] * firstNormal[1]
      : (position[0] - center[0]) * firstNormal[0] + (position[1] - center[1]) * firstNormal[1];
    const normal: XY = side < 0
      ? [-firstNormal[0], -firstNormal[1]]
      : firstNormal;
    const point: XY = [
      center[0] + normal[0] * WALL_THICKNESS_M / 2,
      center[1] + normal[1] * WALL_THICKNESS_M / 2,
    ];
    const distance = Math.hypot(position[0] - point[0], position[1] - point[1]);
    // At corners, prefer the equally close wall whose face points in the
    // camera's viewing direction. Distance remains the primary criterion.
    const alignment = heading
      ? Math.abs(heading[0] * normal[0] + heading[1] * normal[1])
      : 1;
    const score = distance + (heading ? (1 - alignment) * .15 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { point, tangent, normal, distance, wall };
    }
  }
  return best;
}

const material = (color: THREE.ColorRepresentation, roughness = .65, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

export function cameraModel(id: string, active: boolean, headingDegrees: number, mount: Pick<WallMount, "normal" | "tangent">) {
  const group = new THREE.Group();
  group.name = `wall-camera-${id}`;
  const selected = active ? 0x5b4fe8 : 0xf6f7fb;
  const dark = material(0x151927, .3, .08);
  const white = material(selected, .38, .04);
  const bracket = material(active ? 0x7469eb : 0xc7ccda, .5, .12);
  const heading = headingDegrees * Math.PI / 180;
  const forward = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading)).normalize();
  const outward = new THREE.Vector3(mount.normal[0], 0, -mount.normal[1]).normalize();
  const tangentAngle = Math.atan2(mount.tangent[1], mount.tangent[0]);

  // The origin is the rendered wall surface: the back of the plate is flush
  // with that face, with the bracket and housing entirely outside it.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(MOUNT_PLATE_WIDTH, MOUNT_PLATE_HEIGHT, MOUNT_PLATE_DEPTH), bracket);
  plate.name = "mount-plate";
  plate.rotation.y = tangentAngle;
  plate.position.copy(outward.clone().multiplyScalar(MOUNT_PLATE_DEPTH / 2));
  plate.userData.id = id;
  group.add(plate);

  // The bracket always leaves the wall perpendicular to its face. Lens aim is
  // applied only to the swivelling camera body below.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.016, .02, .075, 12), bracket);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
  arm.position.copy(outward.clone().multiplyScalar(.052));
  arm.userData.id = id;
  group.add(arm);

  const camera = new THREE.Group();
  camera.position.copy(outward.clone().multiplyScalar(.115));
  camera.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), forward);

  // Ring-style cylindrical housing with a black face and layered glass lens.
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .135, 24), white);
  housing.rotation.z = -Math.PI / 2;
  housing.userData.id = id;
  camera.add(housing);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(.047, .047, .007, 24), dark);
  face.rotation.z = -Math.PI / 2;
  face.position.x = .071;
  face.userData.id = id;
  camera.add(face);
  const lensRim = new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, .012, 24), material(0x485064, .25, .45));
  lensRim.rotation.z = -Math.PI / 2;
  lensRim.position.x = .078;
  camera.add(lensRim);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(.021, 20, 12),
    new THREE.MeshPhysicalMaterial({ color: 0x10192a, roughness: .08, metalness: .15, clearcoat: 1 }));
  lens.scale.x = .35;
  lens.position.x = .085;
  camera.add(lens);
  const status = new THREE.Mesh(new THREE.SphereGeometry(.005, 10, 8), material(active ? 0x87f4ff : 0x87a7bd, .18));
  status.position.set(.082, .03, 0);
  camera.add(status);
  group.add(camera);
  return group;
}

function doorModel(
  portal: Layout["portals"][number],
  elevation: number,
) {
  const [start, originalEnd] = portal.segment_xy_m;
  const dx = originalEnd[0] - start[0];
  const dy = originalEnd[1] - start[1];
  const length = Math.max(.5, Math.hypot(dx, dy));
  const openAngle = portal.state === "open" ? Math.PI * .42 : 0;
  const cos = Math.cos(openAngle), sin = Math.sin(openAngle);
  const end: XY = [
    start[0] + dx * cos - dy * sin,
    start[1] + dx * sin + dy * cos,
  ];
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
  const group = new THREE.Group();
  group.name = `door-${portal.id}`;
  group.position.copy(worldToViewer([
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
    elevation + .49,
  ]));
  group.rotation.y = angle;

  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(length, .96, .055),
    material(0xb98557, .72),
  );
  leaf.castShadow = true;
  leaf.receiveShadow = true;
  group.add(leaf);
  // Recessed panels and a metal handle make the door readable from the
  // default oblique view without turning it into oversized UI decoration.
  [-.24, .24].forEach(y => {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(length * .7, .31, .018),
      material(0x9f7048, .78),
    );
    panel.position.set(0, y, .035);
    group.add(panel);
  });
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(.035, 12, 8),
    material(0xd7b873, .25, .65),
  );
  handle.position.set(length * .38, 0, .065);
  group.add(handle);
  return group;
}

function courierModel(marker: Marker) {
  const group = new THREE.Group();
  group.name = "delivery-worker-model";
  const green = material(0x72d329, .72);
  const greenDark = material(0x3d7f22, .75);
  const charcoal = material(0x34373c, .84);
  const skin = material(0xc98762, .82);
  const parcel = material(0xb77a3d, .9);
  const black = material(0x17191c, .7);
  const white = material(0xe8e9ea, .78);
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  // Local Y is vertical. At 1.72 m tall this reads as a person at house scale.
  add(new THREE.Mesh(new THREE.CapsuleGeometry(.18, .48, 5, 10), green), 0, 1.08, 0);
  add(new THREE.Mesh(new THREE.SphereGeometry(.145, 18, 12), skin), 0, 1.55, 0);
  const cap = add(new THREE.Mesh(new THREE.SphereGeometry(.155, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), green), 0, 1.68, 0);
  cap.scale.y = .45;
  add(new THREE.Mesh(new THREE.BoxGeometry(.22, .025, .12), green), .1, 1.66, 0);
  [-.11, .11].forEach((x) => {
    add(new THREE.Mesh(new THREE.CapsuleGeometry(.075, .44, 4, 8), charcoal), x, .48, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(.17, .1, .28), white), x, .09, .025);
  });
  [-1, 1].forEach((side) => {
    const arm = add(new THREE.Mesh(new THREE.CapsuleGeometry(.06, .38, 4, 8), skin), side * .24, 1.11, .1);
    arm.rotation.z = side * .38;
  });
  add(new THREE.Mesh(new THREE.BoxGeometry(.52, .08, .34), parcel), .1, 1.03, -.26);
  add(new THREE.Mesh(new THREE.BoxGeometry(.36, .48, .16), greenDark), -.02, 1.14, .2);
  [-.16, .16].forEach(x => add(new THREE.Mesh(new THREE.BoxGeometry(.035, .5, .035), black), x, 1.2, .1));
  group.rotation.y = ((90 - (marker.headingDegrees ?? 90)) * Math.PI) / 180;
  group.scale.setScalar(.58);
  return group;
}

function orientActor(group: THREE.Group, marker: Marker, scale = .58) {
  group.rotation.y = ((90 - (marker.headingDegrees ?? 90)) * Math.PI) / 180;
  group.scale.setScalar(scale);
  return group;
}

function personModel(marker: Marker, kind: ActivityKind) {
  const group = new THREE.Group();
  group.name = kind === "face_covering" ? "face-covering-person-model"
    : ["weapon", "intrusion", "possible_threat"].includes(kind)
      ? `possible-${kind}-person-model`
      : "unidentified-person-model";
  const threatening = ["weapon", "intrusion", "possible_threat"].includes(kind);
  const clothes = material(threatening ? 0x17191c : kind === "face_covering" ? 0x546779 : 0xc23b47, .78);
  const trousers = material(threatening ? 0x090a0c : 0x34373c, .84);
  const skin = material(0xb97959, .82);
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  add(new THREE.Mesh(new THREE.CapsuleGeometry(.18, .48, 5, 10), clothes), 0, 1.08, 0);
  add(new THREE.Mesh(new THREE.SphereGeometry(.145, 18, 12), threatening ? clothes : skin), 0, 1.55, 0);
  [-.11, .11].forEach(x => add(new THREE.Mesh(new THREE.CapsuleGeometry(.075, .44, 4, 8), trousers), x, .48, 0));
  [-1, 1].forEach(side => {
    const arm = add(new THREE.Mesh(new THREE.CapsuleGeometry(.06, .4, 4, 8), threatening ? clothes : skin), side * .23, 1.08, 0);
    arm.rotation.z = side * .2;
  });
  if (kind === "face_covering") {
    add(new THREE.Mesh(new THREE.BoxGeometry(.21, .1, .035), material(0xdce8ee, .8)), 0, 1.52, -.135);
  }
  if (kind === "weapon" || kind === "possible_threat") {
    const object = add(new THREE.Mesh(new THREE.BoxGeometry(.055, .34, .07), material(0x08090b, .35, .2)), -.27, .96, -.08);
    object.rotation.z = -.35;
  }
  if (kind === "intrusion") {
    const hood = add(new THREE.Mesh(new THREE.TorusGeometry(.16, .035, 8, 18, Math.PI), clothes), 0, 1.56, 0);
    hood.rotation.x = Math.PI / 2;
  }
  return orientActor(group, marker);
}

function objectModel(marker: Marker, kind: ActivityKind) {
  const group = new THREE.Group();
  group.name = `${kind}-model`;
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  if (kind === "package") {
    add(new THREE.Mesh(new THREE.BoxGeometry(.48, .34, .38), material(0xb77a3d, .9)), 0, .17, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(.09, .345, .385), material(0xe2bd84, .88)), 0, .17, 0);
    return orientActor(group, marker, .82);
  }
  if (kind === "animal") {
    const fur = material(0x9a744f, .9);
    const body = add(new THREE.Mesh(new THREE.CapsuleGeometry(.14, .42, 5, 10), fur), 0, .38, 0);
    body.rotation.z = Math.PI / 2;
    add(new THREE.Mesh(new THREE.SphereGeometry(.18, 14, 10), fur), .34, .44, 0);
    [-.22, .2].forEach(x => [-.1, .1].forEach(z =>
      add(new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, .27, 8), fur), x, .14, z)));
    const tail = add(new THREE.Mesh(new THREE.CylinderGeometry(.025, .04, .32, 8), fur), -.34, .48, 0);
    tail.rotation.z = -.75;
    return orientActor(group, marker, .78);
  }
  if (kind === "vehicle") {
    const blue = material(0x386987, .45, .16);
    add(new THREE.Mesh(new THREE.BoxGeometry(.95, .28, .5), blue), 0, .25, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(.5, .24, .43), material(0x8db4ca, .3, .1)), -.05, .49, 0);
    [-.3, .3].forEach(x => [-.27, .27].forEach(z => {
      const wheel = add(new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .055, 12), material(0x17191c, .8)), x, .14, z);
      wheel.rotation.x = Math.PI / 2;
    }));
    return orientActor(group, marker, .7);
  }
  if (kind === "none") {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.28, .045, 10, 28), material(0x55715e, .7));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .06;
    group.add(ring);
    add(new THREE.Mesh(new THREE.BoxGeometry(.34, .05, .05), material(0x55715e, .7)), 0, .07, 0);
    return group;
  }
  add(new THREE.Mesh(new THREE.OctahedronGeometry(.28), material(0x666970, .62)), 0, .3, 0);
  const halo = add(new THREE.Mesh(new THREE.TorusGeometry(.34, .025, 8, 24), material(0xd6a546, .5)), 0, .3, 0);
  halo.rotation.x = Math.PI / 2;
  return orientActor(group, marker, .8);
}

function activityModel(marker: Marker) {
  const kind = marker.actorKind ?? "person";
  if (kind === "delivery") return courierModel(marker);
  if (["person", "face_covering", "weapon", "intrusion", "possible_threat"].includes(kind))
    return personModel(marker, kind);
  return objectModel(marker, kind);
}

export function activityModelName(kind?: ActivityKind) {
  if (kind === "delivery") return "delivery-worker";
  if (kind === "face_covering") return "face-covering-person";
  if (kind === "weapon" || kind === "possible_threat") return "possible-weapon-person";
  if (kind === "intrusion") return "possible-intrusion-person";
  if (kind === "package") return "package";
  if (kind === "animal") return "animal";
  if (kind === "vehicle") return "vehicle";
  if (kind === "unknown") return "unclear-activity";
  if (kind === "none") return "no-relevant-activity";
  return "unidentified-person";
}
export default function Scene3D({
  layout,
  selected,
  onSelect,
  markers = [],
  evidenceLinks = [],
  cameraModelFactory = cameraModel,
}: {
  layout: Layout;
  selected: string;
  onSelect: (id: string) => void;
  markers?: Marker[];
  evidenceLinks?: EvidenceLink[];
  cameraModelFactory?: CameraModelFactory;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const cameraPins = useRef(new Map<string, HTMLButtonElement>());
  const viewPose = useRef<{ extent: string; position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const liveMarkers = useRef<THREE.Group | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError("3D is unavailable. Switch to the 2D map.");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasHost.current!.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eef0f9");
    const plot = footprint(layout, .8);
    const [groundX, groundY, groundW, groundH] = bounds(layout, 1.2, .75);
    const [fallbackX, fallbackY, fallbackW, fallbackH] = bounds(layout);
    const [x, y, w, h] = plot
      ? [plot.x, plot.y, plot.width, plot.height]
      : [fallbackX, fallbackY, fallbackW, fallbackH];
    const buildingSpan = Math.max(w, h),
      center = worldToViewer([x + w / 2, y + h / 2, 0]);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 150);
    camera.position
      .copy(center)
      .add(new THREE.Vector3(w * .64, buildingSpan * .72, h * .68));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    const extent = JSON.stringify([x, y, w, h]);
    if (viewPose.current?.extent === extent) {
      camera.position.copy(viewPose.current.position);
      controls.target.copy(viewPose.current.target);
    }
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = Math.max(2.5, buildingSpan * .35);
    controls.maxDistance = buildingSpan * 3;
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa2c8, 2.9));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(5, 12, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    scene.add(light);
    const markerLayer = new THREE.Group();
    liveMarkers.current = markerLayer;
    scene.add(markerLayer);
    // A plot of ground so the plan sits somewhere instead of floating.
    if (plot) {
      const grass = new THREE.Mesh(
        new THREE.BoxGeometry(groundW, 0.08, groundH),
        new THREE.MeshStandardMaterial({ color: "#8fb277", roughness: 0.95 }),
      );
      grass.position.copy(
        worldToViewer([groundX + groundW / 2, groundY + groundH / 2, -0.05]),
      );
      grass.receiveShadow = true;
      scene.add(grass);
    }
    const meshes: THREE.Mesh[] = [];
    const pinAnchors: { id: string; position: THREE.Vector3 }[] = [];
    layout.rooms.forEach((r) => {
      const shape = new THREE.Shape();
      r.polygon_xy_m.forEach(([a, b], i) =>
        i ? shape.lineTo(a, b) : shape.moveTo(a, b),
      );
      shape.closePath();
      const mesh = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({
          color: r.id === selected ? "#cfc9fb" : "#e9edfa",
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      mesh.userData.id = r.id;
      scene.add(mesh);
      meshes.push(mesh);
    });
    wallSpans(layout, true).forEach((s) => {
      const dx = s.b[0] - s.a[0],
        dy = s.b[1] - s.a[1];
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(Math.hypot(dx, dy), s.top - s.bottom, WALL_THICKNESS_M),
        new THREE.MeshStandardMaterial({ color: "#aab3d8" }),
      );
      m.position.copy(
        worldToViewer([
          (s.a[0] + s.b[0]) / 2,
          (s.a[1] + s.b[1]) / 2,
          (s.top + s.bottom) / 2,
        ]),
      );
      m.rotation.y = Math.atan2(dy, dx);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    });
    layout.portals.forEach(portal => {
      const room = layout.rooms.find(candidate =>
        candidate.id === portal.from_room_id || candidate.id === portal.to_room_id);
      const elevation = layout.floors.find(floor => floor.id === room?.floor_id)?.elevation_m ?? 0;
      scene.add(doorModel(portal, elevation));
    });
    // Coverage is the declared horizontal field of view drawn on the floor.
    // It ignores tilt, walls, and occlusion, matching the 2D wedge.
    layout.cameras.forEach((c) => {
      const active = c.id === selected;
      const elevation =
        layout.floors.find((f) => f.id === c.floor_id)?.elevation_m ?? 0;
      const mount = nearestWallMount(
        layout,
        [c.position_m[0], c.position_m[1]],
        c.heading_degrees,
        c.floor_id,
      );
      // Use the same solid spans as the wall meshes, excluding outdoor slabs,
      // door openings and unsupported ends of a wall.
      const displayedXY: XY = mount?.point ?? [c.position_m[0], c.position_m[1]];
      // Cutaway walls top out at 1.05 m. Keep the visible model physically on
      // that wall even if the stored real-world camera height is above it.
      const preferredZ = elevation + Math.max(.48, Math.min(c.position_m[2] - elevation, .82));
      const verticalInset = MOUNT_PLATE_HEIGHT / 2 + .02;
      const displayedZ = mount
        ? Math.max(mount.wall.bottom + verticalInset, Math.min(preferredZ, mount.wall.top - verticalInset))
        : preferredZ;
      const yaw = (c.heading_degrees * Math.PI) / 180,
        fov = (c.fov_degrees * Math.PI) / 180;
      const wedge = new THREE.Mesh(
        new THREE.CircleGeometry(c.range_m, 48, yaw - fov / 2, fov),
        new THREE.MeshBasicMaterial({
          color: active ? "#5b4fe8" : "#8b93c6",
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      wedge.rotation.x = -Math.PI / 2;
      wedge.position.copy(worldToViewer([displayedXY[0], displayedXY[1], elevation + 0.08]));
      scene.add(wedge);
      const fallbackMount = {
        tangent: [1, 0],
        normal: [0, 1],
      } satisfies Pick<WallMount, "normal" | "tangent">;
      const model = cameraModelFactory(c.id, active, c.heading_degrees, mount ?? fallbackMount);
      model.position.copy(worldToViewer([displayedXY[0], displayedXY[1], displayedZ]));
      // Anchor the UI pin to the displayed hardware, not the unsnapped plan
      // position. Pixel-sized pins stay readable without enlarging the model.
      pinAnchors.push({ id: c.id, position: model.position.clone() });
      model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          if (!object.userData.id) object.userData.id = c.id;
          meshes.push(object);
        }
      });
      scene.add(model);
    });
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let down = [0, 0];
    const start = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const click = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          1 - ((e.clientY - r.top) / r.height) * 2,
        ),
        camera,
      );
      const hit = ray.intersectObjects(meshes)[0];
      if (hit) onSelect(hit.object.userData.id);
    };
    renderer.domElement.addEventListener("pointerdown", start);
    renderer.domElement.addEventListener("pointerup", click);
    let frame = 0;
    const projected = new THREE.Vector3();
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      for (const anchor of pinAnchors) {
        const pin = cameraPins.current.get(anchor.id);
        if (!pin) continue;
        projected.copy(anchor.position).project(camera);
        const visible = projected.z >= -1 && projected.z <= 1
          && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
        pin.style.visibility = visible ? "visible" : "hidden";
        if (visible) pin.style.transform = `translate(${(projected.x + 1) * el.clientWidth / 2}px, ${(1 - projected.y) * el.clientHeight / 2}px) translate(-50%, -100%)`;
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      viewPose.current = { extent, position: camera.position.clone(), target: controls.target.clone() };
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", start);
      renderer.domElement.removeEventListener("pointerup", click);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            m.dispose(),
          );
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      liveMarkers.current = null;
    };
  }, [layout, selected, onSelect, cameraModelFactory]);
  useEffect(() => {
    const layer = liveMarkers.current;
    if (!layer) return;
    layer.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(
          (material) => material.dispose(),
        );
      }
    });
    layer.clear();
    // Historical estimated paths remain when the current person marker expires.
    if (!evidenceLinks.length) markers.slice(1).forEach((to, i) => {
      const from = markers[i];
      if (!to.approximate || !from.approximate || to.gapBefore) return;
      const start = worldToViewer([...from.xy, .11]);
      const end = worldToViewer([...to.xy, .11]);
      const direction = end.clone().sub(start);
      if (direction.length() < .001) return;
      const segment = new THREE.Mesh(
        new THREE.CylinderGeometry(.025, .025, direction.length(), 6),
        new THREE.MeshBasicMaterial({ color: "#b45309", transparent: true, opacity: .65 }),
      );
      segment.position.copy(start.clone().add(end).multiplyScalar(.5));
      segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      layer.add(segment);
    });
    const addEvidenceSegment = (
      start: THREE.Vector3,
      end: THREE.Vector3,
      color: THREE.ColorRepresentation,
      radius: number,
      opacity: number,
    ) => {
      const direction = end.clone().sub(start);
      if (direction.length() < .001) return;
      const segment = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, direction.length(), 7),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
      );
      segment.position.copy(start.clone().add(end).multiplyScalar(.5));
      segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      layer.add(segment);
    };
    evidenceLinks.forEach((link) => {
      const from = markers.find(marker => marker.id === link.fromMarkerId);
      const to = markers.find(marker => marker.id === link.toMarkerId);
      if (!from || !to) return;
      const start = worldToViewer([...from.xy, .13]);
      const end = worldToViewer([...to.xy, .13]);
      const first = start.clone().lerp(end, .42);
      const second = start.clone().lerp(end, .58);
      addEvidenceSegment(start, first, "#b86c18", .035, .78);
      addEvidenceSegment(first, second, "#69707c", .026, .68);
      addEvidenceSegment(second, end, "#b86c18", .035, .78);
      const unknown = new THREE.Mesh(
        new THREE.TorusGeometry(.16, .035, 10, 24),
        new THREE.MeshBasicMaterial({ color: "#69707c", transparent: true, opacity: .82 }),
      );
      unknown.rotation.x = Math.PI / 2;
      unknown.position.copy(first.clone().add(second).multiplyScalar(.5));
      layer.add(unknown);
    });
    markers.forEach((marker) => {
      if (marker.approximate && !marker.selected) return;
      if (marker.approximate && marker.selected) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(
            Math.max(0.08, (marker.uncertainty_m ?? 0.65) - 0.035),
            marker.uncertainty_m ?? 0.65,
            32,
          ),
          new THREE.MeshBasicMaterial({
            color: "#b45309",
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(worldToViewer([...marker.xy, 0.08]));
        layer.add(ring);
      }
      if (marker.evidenceNode) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(.16, .25, 28),
          new THREE.MeshBasicMaterial({ color: "#b86c18", transparent: true, opacity: .72, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(worldToViewer([...marker.xy, .12]));
        layer.add(ring);
        const point = new THREE.Mesh(
          new THREE.SphereGeometry(.085, 14, 10),
          new THREE.MeshStandardMaterial({ color: "#d7902d" }),
        );
        point.position.copy(worldToViewer([...marker.xy, .2]));
        layer.add(point);
      } else if (marker.selected && marker.actorKind) {
        const actor = activityModel(marker);
        actor.position.copy(worldToViewer([...marker.xy, 0]));
        actor.traverse(object => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        layer.add(actor);
      } else {
        const point = new THREE.Mesh(
          new THREE.SphereGeometry(marker.selected ? 0.13 : 0.07, 12, 8),
          new THREE.MeshStandardMaterial({
            color: marker.actorKind ? activityColor(marker.actorKind)
              : marker.approximate ? "#c23b47" : "#e0575f",
          }),
        );
        point.position.copy(worldToViewer([...marker.xy, 0.19]));
        point.castShadow = true;
        layer.add(point);
      }
    });
  }, [layout, markers, evidenceLinks, selected, onSelect, cameraModelFactory]);
  return (
    <div
      className="spatial-scene"
      ref={host}
      role="group"
      data-camera-model="wall-mounted"
      data-door-count={layout.portals.length}
      data-actor-model={activityModelName(markers.find(marker => marker.selected)?.actorKind)}
      data-evidence-links={evidenceLinks.length}
      aria-description={markers.some(marker => marker.approximate) && !markers.some(marker => marker.approximate && marker.selected)
        ? "Estimated path retained. Person not currently visible."
        : undefined}
      aria-label={
        evidenceLinks.length
          ? "Illustrative 3D home map with camera observations and unknown gaps"
          : markers.some((marker) => marker.approximate)
          ? "Illustrative 3D home map with approximate movement trail"
          : "Illustrative 3D home map"
      }
    >
      <div
        className="spatial-scene-canvas"
        ref={canvasHost}
        role="img"
        aria-label={evidenceLinks.length
          ? "Illustrative 3D home map with camera observations and unknown gaps"
          : markers.some(marker => marker.approximate)
          ? "Illustrative 3D home map with approximate movement trail"
          : "Illustrative 3D home map"}
      />
      {!error && <div className="scene-camera-pins" aria-label="Cameras on the 3D map">
        {layout.cameras.map(camera => (
          <button
            key={camera.id}
            ref={element => {
              if (element) cameraPins.current.set(camera.id, element);
              else cameraPins.current.delete(camera.id);
            }}
            className="scene-camera-pin"
            type="button"
            style={{ visibility: "hidden" }}
            aria-label={`Select ${camera.name} on 3D map`}
            aria-pressed={selected === camera.id}
            title={camera.name}
            onClick={() => onSelect(camera.id)}
          >
            <span className="scene-camera-pin-name">{camera.name}</span>
            <span className="scene-camera-pin-face" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 4 7 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2-3Z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </span>
            <span className="scene-camera-pin-stem" aria-hidden="true" />
          </button>
        ))}
      </div>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
