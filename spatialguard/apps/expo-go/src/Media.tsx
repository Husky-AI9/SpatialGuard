import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
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

/** Hex SHA-256 of a downloaded clip; the track route checks it is the same recording. */
async function sha256(file: File) {
  const bytes = await file.arrayBuffer();
  const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function forget(file: File | null) {
  try {
    if (file?.exists) file.delete();
  } catch {
    // The system clears the cache if deletion fails.
  }
}

/**
 * The selected event's Ring recording, as in the web review.
 *
 * iOS's player only streams from servers that answer byte-range requests, and
 * the clip endpoint returns the whole recording at once, so the clip is
 * downloaded natively into the app's private cache (with progress), played
 * from there, and deleted afterwards. The detected person track is fetched for
 * the same clip and followed with the video playhead.
 *
 * `playToken` restarts the clip from the beginning (the timeline's Play) and
 * `paused` pauses it.
 */
export function EventRecording({
  incident,
  observation,
  hasCamera,
  playToken = 0,
  paused = false,
  onTime,
  onTrack,
  onEnded,
}: {
  incident: string;
  observation: string;
  hasCamera: boolean;
  playToken?: number;
  paused?: boolean;
  onTime: (seconds: number, duration: number) => void;
  onTrack: (track: Track | null) => void;
  onEnded?: () => void;
}) {
  const [clip, setClip] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
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
    const name = `${incident}-${observation}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
    const target = new File(Paths.cache, `recording-${name}.mp4`);
    setClip(null);
    setError("");
    setProgress(0);
    setAt(0);
    callbacks.current.onTime(0, 0);
    File.downloadFileAsync(
      ORIGIN + `/v1/incidents/${encodeURIComponent(incident)}/observations/${encodeURIComponent(observation)}/clip`,
      target,
      {
        headers: authHeaders(),
        idempotent: true,
        signal: controller.signal,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes > 0) setProgress(Math.min(1, bytesWritten / totalBytes));
        },
      },
    )
      .then((file) => {
        if (controller.signal.aborted) forget(file);
        else setClip(file);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("The Ring recording couldn’t be loaded. Try again.");
      });
    return () => {
      controller.abort();
      forget(target);
    };
  }, [incident, observation, attempt]);

  useEffect(() => {
    let live = true;
    setTrack(null);
    setTrackError("");
    callbacks.current.onTrack(null);
    if (!clip || !hasCamera) return;
    sha256(clip)
      .then((digest) =>
        request<Track>(
          `/v1/incidents/${encodeURIComponent(incident)}/observations/${encodeURIComponent(observation)}/track?clip_digest=${digest}`,
          "GET",
          undefined,
          150000,
        ),
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
  }, [incident, observation, clip, hasCamera, trackAttempt]);

  const first = track?.points[0]?.t_seconds ?? 0;
  const last = track?.points[track.points.length - 1]?.t_seconds ?? 0;
  const movement = !hasCamera
    ? "Map camera unavailable for this visit."
    : trackError || (!clip ? "Movement waits for the recording." : !track ? "Finding the person in the recording…"
      : !track.points.length ? "No person detected in this recording."
      : at < first ? "Person has not appeared yet."
      : at <= last + 1.25 ? "Following the person · estimated map position"
      : "Person out of view · path so far kept on the map");

  return (
    <View style={{ gap: 8 }}>
      {clip ? (
        <ClipPlayer
          uri={clip.uri}
          playToken={playToken}
          paused={paused}
          onTime={(seconds, duration) => {
            setAt(seconds);
            callbacks.current.onTime(seconds, duration);
          }}
          onEnded={() => callbacks.current.onEnded?.()}
          onError={() => setError("This recording can’t be played on this device.")}
        />
      ) : !error ? (
        <View style={{ height: 210, borderRadius: 12, backgroundColor: "#1d1f2e", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <ActivityIndicator color="#ffffff" />
          <Label style={{ color: "#e4e6f2", fontSize: 13 }}>
            Loading the Ring recording{progress > 0 ? ` · ${Math.round(progress * 100)}%` : "…"}
          </Label>
          <View style={{ width: 160, height: 4, borderRadius: 2, backgroundColor: "#3a3d5c", overflow: "hidden" }}>
            <View style={{ width: `${Math.round(progress * 100)}%`, height: 4, backgroundColor: "#9d92f2" }} />
          </View>
        </View>
      ) : null}
      <Label style={[styles.muted, { fontSize: 13 }]}>{error || "Ring recording · video only"}</Label>
      {clip && <Label style={{ fontSize: 13, color: "#23253f", fontFamily: "SourceSansBold" }}>{movement}</Label>}
      {!!error && <Button small variant="secondary" title="Retry recording" onPress={() => setAttempt((n) => n + 1)} />}
      {!!trackError && <Button small variant="secondary" title="Retry movement" onPress={() => setTrackAttempt((n) => n + 1)} />}
    </View>
  );
}

function ClipPlayer({
  uri,
  playToken,
  paused,
  onTime,
  onEnded,
  onError,
}: {
  uri: string;
  playToken: number;
  paused: boolean;
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
  // The timeline's Play restarts this event's clip from the beginning.
  const firstToken = useRef(playToken);
  useEffect(() => {
    if (playToken === firstToken.current) return;
    player.currentTime = 0;
    player.play();
  }, [playToken, player]);
  useEffect(() => {
    if (paused) player.pause();
  }, [paused, player]);
  return (
    <VideoView
      player={player}
      style={{ height: 210, width: "100%", borderRadius: 12, backgroundColor: "#000" }}
      nativeControls
      contentFit="contain"
    />
  );
}
