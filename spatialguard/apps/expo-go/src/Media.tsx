import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { useVideoPlayer, VideoView } from "expo-video";
import { ORIGIN, authHeaders, request, type Device, type Track } from "./api";
import { Button, Label, styles } from "./ui";
import CameraIcon from "./CameraIcon";
export function Snapshot({ device }: { device: Device }) {
  const [failed, setFailed] = useState(false);
  return device.site_id && device.camera_id && !failed ? (
    <Image
      accessibilityLabel={device.name + " latest snapshot"}
      source={{
        uri:
          ORIGIN +
          `/v1/ring/sites/${device.site_id}/cameras/${device.camera_id}/snapshot`,
        headers: authHeaders(),
      }}
      style={{
        width: 56,
        height: 56,
        borderRadius: 12,
        backgroundColor: "#e6e6f3",
      }}
      onError={() => setFailed(true)}
    />
  ) : (
    <View
      style={{
        width: 56,
        height: 56,
        backgroundColor: "#e6e6f3",
        justifyContent: "center",
        alignItems: "center",
        borderRadius: 12,
      }}
    >
      <CameraIcon size={22} color="#39406b" strokeWidth={1.9} />
    </View>
  );
}
type Clip = { uri: string; digest: string };

/** Download an event recording into the private cache; returns its file and digest. */
async function downloadClip(incident: string, observation: string, signal: AbortSignal): Promise<Clip> {
  const response = await fetch(
    ORIGIN + `/v1/incidents/${encodeURIComponent(incident)}/observations/${encodeURIComponent(observation)}/clip`,
    { headers: authHeaders(), signal },
  );
  if (!response.ok) throw new Error("Recording unavailable. Try again.");
  const digest = response.headers.get("x-spatialguard-clip-digest") ?? "";
  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const name = `${incident}-${observation}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  const file = new File(Paths.cache, `recording-${name}.mp4`);
  if (file.exists) file.delete();
  file.create();
  file.write(data.slice(data.indexOf(",") + 1), { encoding: "base64" });
  return { uri: file.uri, digest };
}

function forget(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The system clears the cache if deletion fails.
  }
}

/**
 * The selected event's Ring recording, as in the web review. iOS's player
 * only streams from servers that answer byte-range requests, so the clip is
 * cached privately while it plays and deleted afterwards. The detected person
 * track is fetched for the same clip and followed with the video playhead.
 */
export function EventRecording({
  incident,
  observation,
  hasCamera,
  onTime,
  onTrack,
  onEnded,
}: {
  incident: string;
  observation: string;
  hasCamera: boolean;
  onTime: (seconds: number, duration: number) => void;
  onTrack: (track: Track | null) => void;
  onEnded?: () => void;
}) {
  const [clip, setClip] = useState<Clip | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [track, setTrack] = useState<Track | null>(null);
  const [trackError, setTrackError] = useState("");
  const [trackAttempt, setTrackAttempt] = useState(0);
  const [at, setAt] = useState(0);
  const callbacks = useRef({ onTime, onTrack, onEnded });
  callbacks.current = { onTime, onTrack, onEnded };

  useEffect(() => {
    const controller = new AbortController();
    let saved = "";
    setClip(null);
    setError("");
    setAt(0);
    callbacks.current.onTime(0, 0);
    downloadClip(incident, observation, controller.signal)
      .then((value) => {
        saved = value.uri;
        if (controller.signal.aborted) forget(saved);
        else setClip(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Recording unavailable. Try again.");
      });
    return () => {
      controller.abort();
      if (saved) forget(saved);
    };
  }, [incident, observation, attempt]);

  useEffect(() => {
    let live = true;
    setTrack(null);
    setTrackError("");
    callbacks.current.onTrack(null);
    if (!clip?.digest || !hasCamera) return;
    request<Track>(
      `/v1/incidents/${encodeURIComponent(incident)}/observations/${encodeURIComponent(observation)}/track?clip_digest=${clip.digest}`,
      "GET",
      undefined,
      150000,
    )
      .then((value) => {
        if (!live) return;
        setTrack(value);
        callbacks.current.onTrack(value);
      })
      .catch((problem) => live && setTrackError(problem instanceof Error ? problem.message : "Movement analysis unavailable."));
    return () => {
      live = false;
    };
  }, [incident, observation, clip?.digest, hasCamera, trackAttempt]);

  const first = track?.points[0]?.t_seconds ?? 0;
  const last = track?.points[track.points.length - 1]?.t_seconds ?? 0;
  const movement = !hasCamera
    ? "Map camera unavailable for this incident."
    : trackError || (!clip ? "Movement waits for the recording." : !track ? "Analyzing recorded movement…"
      : !track.points.length ? "No person detected in this recording."
      : at < first ? "Person has not appeared yet."
      : at <= last + 1.25 ? "Following detected person · estimated map position"
      : "Person not visible · last observed path retained");

  return (
    <View style={{ gap: 8 }}>
      {clip ? (
        <ClipPlayer
          uri={clip.uri}
          onTime={(seconds, duration) => {
            setAt(seconds);
            callbacks.current.onTime(seconds, duration);
          }}
          onEnded={() => callbacks.current.onEnded?.()}
          onError={() => setError("This recording can't be played on this device.")}
        />
      ) : !error ? (
        <View style={{ height: 210, borderRadius: 12, backgroundColor: "#1d1f2e", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <ActivityIndicator color="#ffffff" />
          <Label style={{ color: "#e4e6f2", fontSize: 13 }}>Loading event recording from Ring…</Label>
        </View>
      ) : null}
      <Label style={[styles.muted, { fontSize: 13 }]} accessibilityRole="text">
        {error || "Recorded Ring event · video only"}
      </Label>
      {clip && <Label style={{ fontSize: 13, color: "#23253f", fontFamily: "SourceSansBold" }}>{movement}</Label>}
      {!!error && <Button small variant="secondary" title="Retry recording" onPress={() => setAttempt((n) => n + 1)} />}
      {!!trackError && <Button small variant="secondary" title="Retry movement" onPress={() => setTrackAttempt((n) => n + 1)} />}
    </View>
  );
}

function ClipPlayer({
  uri,
  onTime,
  onEnded,
  onError,
}: {
  uri: string;
  onTime: (seconds: number, duration: number) => void;
  onEnded: () => void;
  onError: () => void;
}) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.muted = true;
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });
  const handlers = useRef({ onTime, onEnded, onError });
  handlers.current = { onTime, onEnded, onError };
  useEffect(() => {
    const subs = [
      player.addListener("timeUpdate", (e) => handlers.current.onTime(e.currentTime, player.duration || 0)),
      player.addListener("playToEnd", () => handlers.current.onEnded()),
      player.addListener("statusChange", (e) => {
        if (e.status === "error") handlers.current.onError();
      }),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [player]);
  return (
    <VideoView
      player={player}
      style={{ height: 210, width: "100%", borderRadius: 12, backgroundColor: "#000" }}
      nativeControls
      contentFit="contain"
    />
  );
}
