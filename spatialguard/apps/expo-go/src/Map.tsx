import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { MotionTracker } from "../../../../packages/spatial-view/liveMotion";
import { ORIGIN, authHeaders, request, type Incident, type Site, type Track } from "./api";
import { Label, colors, styles } from "./ui";
import mapEmbedHtml from "./mapEmbedHtml";

/**
 * The home map. It is the web app's own map (2D, 3D, controls, heatmap and
 * motion) built into a local page (apps/web/src/embed), so iOS matches the
 * web and Android app exactly. The page has no network access and never sees
 * the session token: this component fetches the data and pushes it in.
 */
type Preset = "1h" | "12h" | "24h";
type Heatmap = {
  values: number[];
  samples: number;
  estimated: number;
  [key: string]: unknown;
};
type Message =
  | { type: "ready" }
  | { type: "select"; id: string }
  | { type: "toggleHeat" }
  | { type: "range"; preset: Preset }
  | { type: "capture"; value: boolean };

type Props = {
  site: Site;
  /** Recent visits, for live motion and heatmap refreshes. */
  incidents?: Incident[];
  /**
   * An incident under review, drawn instead of the map modes: its evidence at
   * `step`, and the person detected in that event's recording at `at` seconds.
   */
  review?: { incident: Incident; step: number; track: Track | null; at: number } | null;
  selected?: string;
  onCamera: (id: string) => void;
  /** True while the map is using a touch (pan, pinch, orbit), so the page must not scroll. */
  onCapture?: (active: boolean) => void;
};

/** Cameras that detected motion in the last few seconds. */
function useLiveMotion(incidents: Incident[], siteId: string) {
  const tracker = useRef(new MotionTracker());
  const [active, setActive] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    tracker.current.reset();
    setActive([]);
  }, [siteId]);
  useEffect(() => {
    const { active: next, next: wait } = tracker.current.update(incidents);
    setActive((previous) => (previous.join() === next.join() ? previous : next));
    if (wait === null) return;
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(250, wait + 50));
    return () => clearTimeout(timer);
  }, [incidents, tick]);
  return active;
}

/** The site's floor-plan drawing as a data URI (the page cannot fetch it itself). */
function usePlanImage(site: Site) {
  const [uri, setUri] = useState("");
  const asset = site.layout.floor_plan?.asset_id;
  useEffect(() => {
    setUri("");
    if (!asset) return;
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`${ORIGIN}/v1/sites/${site.id}/floor-plan`, { headers: authHeaders() });
        if (!response.ok) return;
        const blob = await response.blob();
        const value = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        if (alive) setUri(value);
      } catch {
        // The map still works without the drawing underneath.
      }
    })();
    return () => {
      alive = false;
    };
  }, [site.id, asset]);
  return uri;
}

function useHeatmap(siteId: string, enabled: boolean, preset: Preset, refreshKey: unknown) {
  const [data, setData] = useState<Heatmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    request<Heatmap>(`/v1/sites/${siteId}/heatmap?window=${preset}`)
      .then((value) => alive && setData(value))
      .catch((problem) => alive && setError(problem instanceof Error ? problem.message : "Heatmap unavailable"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [siteId, enabled, preset, refreshKey]);
  return { data, loading, error };
}

export default function FloorMap({ site, incidents = [], review = null, selected = "", onCamera, onCapture }: Props) {
  const incident = review?.incident;
  const [view, setView] = useState<"2D" | "3D">("2D");
  const [heatOn, setHeatOn] = useState(false);
  const [preset, setPreset] = useState<Preset>("24h");
  const [ready, setReady] = useState(false);
  const web = useRef<WebView>(null);
  const planImage = usePlanImage(site);
  const moving = useLiveMotion(incidents, site.id);
  // While reviewing, the camera of the selected step pulses, as on the web.
  const current = review ? review.incident.observations[review.step] : undefined;
  const replaying = current && current.category !== "coverage_gap" ? [current.source_id] : [];
  const heat = useHeatmap(site.id, heatOn && !incident, preset, incidents[0]?.id);

  const layout = {
    ...site.layout,
    rooms: site.layout.rooms ?? [],
    zones: site.layout.zones ?? [],
    portals: site.layout.portals ?? [],
    cameras: site.layout.cameras ?? [],
    floors: site.layout.floors ?? [],
  };
  // The review changes with the video playhead, so it is sent on its own and
  // the (large) layout and drawing only when they change.
  const state = {
    view,
    layout,
    planImage,
    selected,
    motionCameras: incident ? replaying : moving,
    heat: { on: heatOn, preset, data: heat.data, loading: heat.loading, error: heat.error },
  };
  const payload = JSON.stringify(state);
  const reviewPayload = JSON.stringify({
    review: review && { ...review, at: Math.round(review.at * 5) / 5 },
  });
  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.sgMap && window.sgMap(${payload}); true;`);
  }, [ready, payload]);
  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.sgMap && window.sgMap(${reviewPayload}); true;`);
  }, [ready, reviewPayload, payload]);

  const capture = useRef(false);
  const setCapture = useCallback(
    (value: boolean) => {
      capture.current = value;
      onCapture?.(value);
    },
    [onCapture],
  );
  useEffect(() => () => onCapture?.(false), [onCapture]);

  const onMessage = (event: WebViewMessageEvent) => {
    let message: Message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === "ready") setReady(true);
    else if (message.type === "select") {
      if (typeof message.id === "string" && layout.cameras.some((c) => c.id === message.id)) onCamera(message.id);
    } else if (message.type === "toggleHeat") setHeatOn((on) => !on);
    else if (message.type === "range" && ["1h", "12h", "24h"].includes(message.preset)) setPreset(message.preset);
    else if (message.type === "capture") setCapture(!!message.value);
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row}>
        <Label style={[styles.heading, { flex: 1 }]}>Ground floor</Label>
        <View style={{ flexDirection: "row", padding: 2, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff" }}>
          {(["2D", "3D"] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="button"
              accessibilityState={{ selected: view === v }}
              onPress={() => setView(v)}
              style={{ minWidth: 48, minHeight: 34, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: view === v ? colors.purple : "transparent" }}
            >
              <Label style={{ fontFamily: "SourceSansBold", fontSize: 15, color: view === v ? "#fff" : colors.muted }}>{v}</Label>
            </Pressable>
          ))}
        </View>
      </View>
      <View
        style={{ height: 380, borderRadius: 14, overflow: "hidden", backgroundColor: colors.grass }}
        // A released finger always hands scrolling back to the page.
        onTouchEnd={() => capture.current && setCapture(false)}
        onTouchCancel={() => capture.current && setCapture(false)}
      >
        <WebView
          ref={web}
          source={{ html: mapEmbedHtml }}
          originWhitelist={["*"]}
          // The page is local; never navigate the map view anywhere else.
          onShouldStartLoadWithRequest={(r) => r.url.startsWith("about:") || r.url.startsWith("data:")}
          onMessage={onMessage}
          onLoadStart={() => setReady(false)}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          allowsLinkPreview={false}
          javaScriptEnabled
          style={{ backgroundColor: colors.grass }}
        />
      </View>
      {incident && (
        <Label style={styles.muted}>Camera observations · positions shown only where available</Label>
      )}
    </View>
  );
}
