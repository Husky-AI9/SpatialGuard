import React, { useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, View } from "react-native";
import Svg, {
  Polygon,
  Path,
  Circle,
  Text as SvgText,
  G,
} from "react-native-svg";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import * as THREE from "three";
import { wallSpans } from "../../../../packages/spatial-view/geometry";
import type { Layout } from "../../../../packages/sdk-typescript";
import type { Site, Incident } from "./api";
import { Button, Label, colors, styles } from "./ui";
import { CameraGlyph } from "./CameraIcon";
type Props = {
  site: Site;
  incident?: Incident | null;
  selected?: string;
  onCamera: (id: string) => void;
};
function bounds(site: Site) {
  const pts = [
    ...(site.layout.rooms ?? []).flatMap((r) => r.polygon_xy_m),
    ...(site.layout.cameras ?? []).flatMap((c) => [
      [c.position_m[0] - c.range_m, c.position_m[1] - c.range_m],
      [c.position_m[0] + c.range_m, c.position_m[1] + c.range_m],
    ]),
  ];
  if (!pts.length) return { x: 0, y: 0, size: 20 };
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    size:
      Math.max(
        10,
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      ) * 1.2,
  };
}
export default function FloorMap(props: Props) {
  const [mode, setMode] = useState<"2D" | "3D">("2D");
  const [zoom, setZoom] = useState(1);
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row}>
        <Label style={[styles.heading, { flex: 1 }]}>Ground floor</Label>
        <View style={{ flexDirection: "row", padding: 2, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff" }}>
          {(["2D", "3D"] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === v }}
              onPress={() => setMode(v)}
              style={{ minWidth: 48, minHeight: 34, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: mode === v ? colors.purple : "transparent" }}
            >
              <Label style={{ fontFamily: "SourceSansBold", fontSize: 15, color: mode === v ? "#fff" : colors.muted }}>{v}</Label>
            </Pressable>
          ))}
        </View>
      </View>
      {mode === "2D" ? (
        <Plan {...props} zoom={zoom} onZoom={setZoom} />
      ) : (
        <Scene {...props} zoom={zoom} />
      )}
      <View style={styles.row}>
        <Button small variant="secondary" title="−" onPress={() => setZoom((z) => Math.max(0.5, z / 1.25))} />
        <Button small variant="secondary" title="Reset view" onPress={() => setZoom(1)} />
        <Button small variant="secondary" title="+" onPress={() => setZoom((z) => Math.min(4, z * 1.25))} />
      </View>
      {props.incident && (
        <Label style={styles.muted}>
          Camera observations · positions shown only where available
        </Label>
      )}
    </View>
  );
}
function Plan({
  site,
  incident,
  selected,
  onCamera,
  zoom,
  onZoom,
}: Props & { zoom: number; onZoom: (z: number) => void }) {
  const b = bounds(site),
    k = (320 / b.size) * zoom;
  const p = (xy: number[]) => [
    160 + (xy[0] - b.x) * k,
    160 - (xy[1] - b.y) * k,
  ];
  const pinch = useRef(0),
    base = useRef(zoom);
  base.current = zoom;
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
    onPanResponderGrant: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length === 2)
        pinch.current = Math.hypot(
          t[0].pageX - t[1].pageX,
          t[0].pageY - t[1].pageY,
        );
    },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length === 2 && pinch.current) {
        const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
        onZoom(Math.max(0.5, Math.min(4, (base.current * d) / pinch.current)));
        pinch.current = d;
      }
    },
  });
  return (
    <View
      {...responder.panHandlers}
      style={{
        backgroundColor: colors.grass,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <Svg width="100%" height={320} viewBox="0 0 320 320">
        {(site.layout.rooms ?? []).map((r) => (
          <G key={r.id}>
            <Polygon
              points={r.polygon_xy_m.map((x) => p(x).join(",")).join(" ")}
              fill="#ececfa"
              stroke="#959bd4"
              strokeWidth="1.5"
            />
            <SvgText
              x={
                p(
                  r.polygon_xy_m.reduce(
                    (s, x) => [
                      s[0] + x[0] / r.polygon_xy_m.length,
                      s[1] + x[1] / r.polygon_xy_m.length,
                    ],
                    [0, 0],
                  ),
                )[0]
              }
              y={
                p(
                  r.polygon_xy_m.reduce(
                    (s, x) => [
                      s[0] + x[0] / r.polygon_xy_m.length,
                      s[1] + x[1] / r.polygon_xy_m.length,
                    ],
                    [0, 0],
                  ),
                )[1]
              }
              textAnchor="middle"
              fontSize="9"
              fontFamily="SourceSans"
              fill="#3a3f63"
            >
              {r.name}
            </SvgText>
          </G>
        ))}
        {(site.layout.cameras ?? []).map((c) => {
          const [x, y] = p(c.position_m),
            r = c.range_m * k,
            a = ((c.heading_degrees - c.fov_degrees / 2) * Math.PI) / 180,
            z = ((c.heading_degrees + c.fov_degrees / 2) * Math.PI) / 180;
          return (
            <G key={c.id} onPress={() => onCamera(c.id)}>
              <Path
                d={`M${x},${y} L${x + r * Math.cos(a)},${y - r * Math.sin(a)} A${r},${r} 0 0 0 ${x + r * Math.cos(z)},${y - r * Math.sin(z)} Z`}
                fill={selected === c.id ? "#8578e84d" : "#9994cb26"}
                stroke={selected === c.id ? "#5b4fe8" : "#9994cb"}
                strokeWidth=".6"
              />
              {selected === c.id && <Circle cx={x} cy={y} r="17" fill={colors.purple} fillOpacity={0.18} />}
              <CameraGlyph
                x={x - 13}
                y={y - 13}
                size={26}
                color={colors.purple}
                fill="#ffffff"
                strokeWidth={2.8}
              />
              {/* White halo copy first so the name stays readable over coverage. */}
              {["halo", "text"].map((layer) => (
                <SvgText
                  key={layer}
                  x={x}
                  y={y - 17}
                  fontSize="10"
                  fontWeight="700"
                  fontFamily="SourceSansBold"
                  textAnchor="middle"
                  fill={colors.ink}
                  stroke={layer === "halo" ? "white" : "none"}
                  strokeWidth={layer === "halo" ? 3 : 0}
                  strokeLinejoin="round"
                >
                  {c.name}
                </SvgText>
              ))}
            </G>
          );
        })}
        {incident?.observations.map((o) =>
          o.location.kind === "floor_point" ? (
            <Circle
              key={o.observation_id}
              cx={p(o.location.xy_m)[0]}
              cy={p(o.location.xy_m)[1]}
              r="4"
              fill="#dd8a32"
              stroke="white"
            />
          ) : null,
        )}
      </Svg>
    </View>
  );
}
function Scene({ site, incident, zoom }: Props & { zoom: number }) {
  const dispose = useRef<() => void>(() => {}),
    orbit = useRef({ angle: 0.65, zoom });
  orbit.current.zoom = zoom;
  const [error, setError] = useState("");
  useEffect(() => () => dispose.current(), []);
  const gesture = PanResponder.create({
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, g) => {
      orbit.current.angle += g.vx * 0.025;
    },
  });
  const create = (gl: ExpoWebGLRenderingContext) => {
    dispose.current();
    try {
      const b = bounds(site),
        scene = new THREE.Scene();
      scene.background = new THREE.Color(colors.grass);
      const canvas = {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
        style: {},
        addEventListener: () => {},
        removeEventListener: () => {},
        getContext: () => gl,
      };
      const renderer = new THREE.WebGLRenderer({
        context: gl as unknown as WebGLRenderingContext,
        canvas: canvas as unknown as HTMLCanvasElement,
      });
      renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
      const camera = new THREE.PerspectiveCamera(
        45,
        gl.drawingBufferWidth / gl.drawingBufferHeight,
        0.1,
        1000,
      );
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(8, 15, 10);
      scene.add(light);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(b.size * 2, b.size * 2),
        new THREE.MeshLambertMaterial({ color: colors.grass }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(b.x, -0.03, -b.y);
      scene.add(plane);
      for (const room of site.layout.rooms ?? []) {
        const shape = new THREE.Shape(
          room.polygon_xy_m.map((p) => new THREE.Vector2(p[0], p[1])),
        );
        const floor = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshLambertMaterial({
            color: "#eeeaf7",
            side: THREE.DoubleSide,
          }),
        );
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);
      }
      const layout = {
        ...site.layout,
        rooms: site.layout.rooms ?? [],
        zones: site.layout.zones ?? [],
        portals: site.layout.portals ?? [],
        cameras: site.layout.cameras ?? [],
      } as Layout;
      for (const span of wallSpans(layout, true)) {
        const { a: p, b: q } = span;
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(
            Math.hypot(q[0] - p[0], q[1] - p[1]),
            span.top - span.bottom,
            0.1,
          ),
          new THREE.MeshLambertMaterial({ color: "#d1d4eb" }),
        );
        wall.position.set(
          (p[0] + q[0]) / 2,
          (span.top + span.bottom) / 2,
          -(p[1] + q[1]) / 2,
        );
        wall.rotation.y = Math.atan2(q[1] - p[1], q[0] - p[0]);
        scene.add(wall);
      }
      for (const c of site.layout.cameras ?? []) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 12, 8),
          new THREE.MeshLambertMaterial({ color: colors.purple }),
        );
        marker.position.set(c.position_m[0], 1.1, -c.position_m[1]);
        scene.add(marker);
        const points = [new THREE.Vector2(c.position_m[0], c.position_m[1])];
        for (let i = 0; i <= 20; i++) {
          const a =
            ((c.heading_degrees -
              c.fov_degrees / 2 +
              (c.fov_degrees * i) / 20) *
              Math.PI) /
            180;
          points.push(
            new THREE.Vector2(
              c.position_m[0] + c.range_m * Math.cos(a),
              c.position_m[1] + c.range_m * Math.sin(a),
            ),
          );
        }
        const fov = new THREE.Mesh(
          new THREE.ShapeGeometry(new THREE.Shape(points)),
          new THREE.MeshBasicMaterial({
            color: colors.purple,
            transparent: true,
            opacity: 0.13,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        fov.rotation.x = -Math.PI / 2;
        fov.position.y = 0.025;
        scene.add(fov);
      }
      for (const o of incident?.observations || []) {
        if (o.location.kind !== "floor_point") continue;
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 12, 8),
          new THREE.MeshLambertMaterial({ color: "#dd8a32" }),
        );
        dot.position.set(o.location.xy_m[0], 0.2, -o.location.xy_m[1]);
        scene.add(dot);
      }
      let frame = 0,
        stopped = false;
      const draw = () => {
        if (stopped) return;
        const d = (b.size * 0.9) / orbit.current.zoom;
        camera.position.set(
          b.x + Math.sin(orbit.current.angle) * d,
          d * 0.9,
          -b.y + Math.cos(orbit.current.angle) * d,
        );
        camera.lookAt(b.x, 0, -b.y);
        renderer.render(scene, camera);
        gl.endFrameEXP();
        frame = requestAnimationFrame(draw);
      };
      draw();
      dispose.current = () => {
        stopped = true;
        cancelAnimationFrame(frame);
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(
              (m) => m.dispose(),
            );
          }
        });
        renderer.dispose();
      };
    } catch (e) {
      setError("3D could not start on this device. Use the 2D map.");
    }
  };
  return error ? (
    <Label>{error}</Label>
  ) : (
    <View {...gesture.panHandlers}>
      <GLView
        key={site.id + ":" + site.revision_id + ":" + (incident?.id || "")}
        style={{ height: 320 }}
        onContextCreate={create}
      />
    </View>
  );
}
