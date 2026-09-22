import { useCallback, useEffect, useRef, useState } from "react";
import { Play, ScanSearch, Sparkles } from "lucide-react";
import type { Camera } from "../../../../packages/sdk-typescript";
import type { components } from "./generated";
import {
  extrapolateExitPath,
  limitMovement,
  projectGroundPoint,
  samplePersonTrack,
  type ProjectedSample,
} from "./motionTracking";
import { request, testVideoMedia } from "./platform";
import {
  ActivityIcon,
  activities,
  actorFromClassification,
  type ActorPresentation,
} from "./activityPresentation";

type Classification = components["schemas"]["IncidentClassification"];
type TestVideo = components["schemas"]["TestVideo"];
type PersonTrack = components["schemas"]["TestVideoTrack"];
export type TestTrack = {
  xy: [number, number];
  confidence: number;
  at: number;
  entity?: "person";
  actorKind?: ActorPresentation["actorKind"];
  actorLabel?: string;
  reviewLevel?: ActorPresentation["reviewLevel"];
  extrapolated?: boolean;
} | {
  xy: [number, number];
  confidence: number;
  at: number;
  entity: "package";
} | { state: "lost" | "clear-package" };

const PACKAGE_DROP_SECONDS: Record<string, number> = {
  "delivery-day": 5,
  "delivery-night": 0.8,
};
function reviewPresentation(classification: Classification) {
  if (
    classification.label === "possible_weapon_visible" ||
    classification.label === "possible_unauthorized_entry"
  )
    return { level: "urgent", text: "Urgent review · verify the camera evidence before acting" };
  if (classification.label === "delivery_activity")
    return { level: "routine", text: "Routine activity · review if the delivery is unexpected" };
  if (activities[classification.label].review === "routine")
    return { level: "routine", text: "Routine activity - review the camera evidence" };
  return { level: "review", text: "Review needed · identity and intent remain unknown" };
}

export default function TestVideoReplay({
  camera,
  onTrack,
  onClassification,
  classificationEnabled,
}: {
  camera: Camera;
  classificationEnabled: boolean;
  onTrack: (track: TestTrack | null) => void;
  onClassification: (classification: Classification | null) => void;
}) {
  const [videos, setVideos] = useState<TestVideo[]>([]);
  const [selected, setSelected] = useState<TestVideo | null>(null);
  const [track, setTrack] = useState<PersonTrack | null>(null);
  const [classification, setClassification] = useState<Classification | null>(null);
  const [message, setMessage] = useState("Choose a clip, then play it to trace movement.");
  const [analyzing, setAnalyzing] = useState(false);
  const [trackingAbsent, setTrackingAbsent] = useState(false);
  const [classificationError, setClassificationError] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaError, setMediaError] = useState("");
  const classificationCache = useRef(new Map<string, Promise<Classification>>());
  const selectionVersion = useRef(0);
  const video = useRef<HTMLVideoElement>(null);
  const classify = useCallback((id: string) => {
    let pending = classificationCache.current.get(id);
    if (!pending) {
      pending = request<Classification>(`/v1/test-videos/${id}/classify`, "POST", undefined, 70000);
      classificationCache.current.set(id, pending);
      void pending.catch(() => classificationCache.current.delete(id));
    }
    return pending;
  }, []);
  const analyze = useCallback((id: string) => {
    const version = selectionVersion.current;
    setAnalyzing(true);
    setClassificationError("");
    void classify(id).then((value) => {
      if (selectionVersion.current !== version) return;
      setClassification(value);
      onClassification(value);
    }).catch((error) => {
      if (selectionVersion.current === version)
        setClassificationError(error.message || "Classification unavailable.");
    }).finally(() => {
      if (selectionVersion.current === version) setAnalyzing(false);
    });
  }, [classify, onClassification]);
  useEffect(() => {
    if (!selected) return;
    selectionVersion.current++;
    setClassification(null);
    onClassification(null);
    setClassificationError("");
    setAnalyzing(false);
    if (classificationEnabled || classificationCache.current.has(selected.id)) analyze(selected.id);
    return () => { selectionVersion.current++; };
  }, [selected?.id, classificationEnabled, analyze, onClassification]);
  const timer = useRef<number | null>(null);
  const projected = useRef<{ xy: [number, number]; at: number } | null>(null);
  const projectionHistory = useRef<ProjectedSample[]>([]);
  const exitExtended = useRef(false);
  const packagePlaced = useRef(false);

  useEffect(() => {
    void request<TestVideo[]>("/v1/test-videos")
      .then((items) => {
        setVideos(items);
        setSelected(items.find((item) => item.lighting === "day") ?? items[0] ?? null);
      })
      .catch((error) => setMessage(error.message || "Test videos are unavailable."));
    return () => {
      onTrack(null);
      onClassification(null);
    };
  }, [onTrack, onClassification]);

  const stop = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setTrack(null);
    setMessage("Preparing OpenCV person track…");
    void request<PersonTrack>(`/v1/test-videos/${selected.id}/track`)
      .then((value) => {
        if (!active) return;
        setTrack(value);
        setMessage(
          value.points.length
            ? "Person track ready · press play"
            : "No person was detected in this clip",
        );
      })
      .catch((error) => active && setMessage(error.message || "Person detector unavailable."));
    return () => {
      active = false;
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    let objectUrl = "";
    setMediaUrl("");
    setMediaError("");
    void testVideoMedia(selected.id)
      .then((url) => {
        objectUrl = url;
        if (active) setMediaUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch((error) => active && setMediaError(error.message || "Test video is unavailable."));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.id]);

  const sample = () => {
    const player = video.current;
    if (!player || !track?.points.length) return;
    const at = player.currentTime;
    const position = samplePersonTrack(track.points, at);
    const actor: ActorPresentation = classification
      ? actorFromClassification(classification)
      : selected?.id.startsWith("delivery-")
        ? { actorKind: "delivery", actorLabel: "Delivery worker", reviewLevel: "routine" }
        : { actorKind: "person", actorLabel: "Person · not classified", reviewLevel: "review" };
    if (position.state !== "visible" || player.ended) {
      if (position.state === "after" && !exitExtended.current) {
        const continuation = extrapolateExitPath(camera, projectionHistory.current);
        const lastAt = projectionHistory.current.at(-1)?.at ?? at;
        continuation.forEach((xy, index) => onTrack({
          xy,
          confidence: 0.22,
          at: lastAt + (index + 1) * 0.38,
          entity: "person",
          ...actor,
          extrapolated: true,
        }));
        exitExtended.current = continuation.length > 0;
      }
      if (projected.current) onTrack({ state: "lost" });
      projected.current = null;
      setTrackingAbsent(true);
      setMessage(player.ended
        ? "Replay complete - no current position"
        : position.state === "before"
          ? "Person has not appeared yet"
          : position.state === "gap"
            ? "Detection lost - position unknown"
            : "No longer visible - position unknown");
      return;
    }
    setTrackingAbsent(false);
    const target = projectGroundPoint(camera, position.footX, position.footY),
      previous = projected.current,
      xy = limitMovement(previous?.xy ?? null, target, previous ? at - previous.at : 0);
    projected.current = { xy, at };
    const prior = projectionHistory.current.at(-1);
    if (!prior || Math.hypot(prior.xy[0] - xy[0], prior.xy[1] - xy[1]) >= 0.06) {
      projectionHistory.current.push({ xy, at });
      projectionHistory.current = projectionHistory.current.filter((sample) => at - sample.at <= 2.4);
    }
    const dropAt = selected ? PACKAGE_DROP_SECONDS[selected.id] : undefined;
    if (dropAt !== undefined && at >= dropAt && !packagePlaced.current) {
      const fromCameraX = xy[0] - camera.position_m[0];
      const fromCameraY = xy[1] - camera.position_m[1];
      const distance = Math.max(0.01, Math.hypot(fromCameraX, fromCameraY));
      onTrack({
        entity: "package",
        xy: [
          camera.position_m[0] + fromCameraX / distance * 0.55,
          camera.position_m[1] + fromCameraY / distance * 0.55,
        ],
        confidence: 0.62,
        at,
      });
      packagePlaced.current = true;
    }
    setMessage("Person detected · stabilized ground-point estimate");
    onTrack({
      xy,
      confidence: position.confidence,
      at,
      entity: "person",
      ...actor,
    });
  };

  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  const start = () => {
    stop();
    projected.current = null;
    if (!track?.points.length || (video.current?.currentTime ?? 0) <= track.points[0].t_seconds + 0.5) {
      projectionHistory.current = [];
      exitExtended.current = false;
      packagePlaced.current = false;
      onTrack({ state: "clear-package" });
    }
    setMessage(track ? "Following detected person…" : "Preparing person track…");
    sampleRef.current();
    timer.current = window.setInterval(() => sampleRef.current(), 140);
  };

  const choose = (item: TestVideo) => {
    if (item.id === selected?.id) return;
    stop();
    projected.current = null;
    projectionHistory.current = [];
    exitExtended.current = false;
    packagePlaced.current = false;
    selectionVersion.current++;
    setSelected(item);
    setTrackingAbsent(false);
    setClassification(null);
    onClassification(null);
    setMessage("Preparing person track…");
    onTrack(null);
  };

  if (!selected) return <div className="test-video-empty">{message}</div>;
  const playbackMessage = mediaError || (!mediaUrl ? "Loading private test video..." : message);
  return (
    <div className="test-video-replay">
      <div className="test-video-tabs" aria-label="Private Ring test videos">
        {videos.map((item) => (
          <button
            key={item.id}
            aria-pressed={item.id === selected.id}
            onClick={() => choose(item)}
          >
            {item.lighting === "day" ? "Day delivery" : "Night delivery"}
          </button>
        ))}
      </div>
      <div className="test-video-stage">
        <video
          ref={video}
          key={selected.id}
          src={mediaUrl || undefined}
          controls
          playsInline
          preload="metadata"
          aria-busy={!mediaUrl}
          onPlay={start}
          onPause={() => { stop(); sampleRef.current(); }}
          onSeeked={() => sampleRef.current()}
          onTimeUpdate={() => { if (!video.current?.seeking) sampleRef.current(); }}
          onSeeking={() => {
            projected.current = null;
            projectionHistory.current = [];
            exitExtended.current = false;
            packagePlaced.current = false;
            onTrack({ state: "clear-package" });
            onTrack({ state: "lost" });
          }}
          onEnded={() => {
            stop();
            projected.current = null;
            onTrack({ state: "lost" });
            setTrackingAbsent(true);
            setMessage("Replay complete - no current position");
          }}
          aria-label={selected.name}
        />
      </div>
      <div
        className={`test-video-status${classification ? ` test-video-status-${reviewPresentation(classification).level}` : ""}`}
        role="status"
      >
        {classification ? <ActivityIcon classification={classification} /> : <ScanSearch size={16} />}
        <span>
          <strong>
            {trackingAbsent ? playbackMessage : classification ? reviewPresentation(classification).text : analyzing ? "Checking activity across the clip…" : playbackMessage}
          </strong>
          <small>
            {classification
              ? `${classification.display_label} · ${classification.confidence} confidence · ${playbackMessage}`
              : `${playbackMessage} · estimated map position`}
          </small>
        </span>
      </div>
      {classificationError && <p className="test-video-error">Classification unavailable: {classificationError}</p>}
      {classification ? (
        <div className="test-video-classification">
          <div
            className={`classification-review classification-review-${reviewPresentation(classification).level}`}
          >
            {reviewPresentation(classification).text}
          </div>
          <span>{classification.display_label}</span>
          <strong>{classification.confidence} confidence</strong>
          <p>{classification.summary}</p>
          <small>Uncertainty: {classification.uncertainty}</small>
        </div>
      ) : (
        <button
          className="test-video-analyze"
          disabled={analyzing}
          onClick={() => analyze(selected.id)}
        >
          {analyzing ? <Sparkles size={16} /> : <Play size={16} />}
          {analyzing ? "Analyzing video sequence…" : "Classify this event"}
        </button>
      )}
    </div>
  );
}
