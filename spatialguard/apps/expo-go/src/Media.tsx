import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { useVideoPlayer, VideoView } from "expo-video";
import { ApiError, ORIGIN, authHeaders, request, type Device, type Track } from "./api";
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

/**
 * Hex SHA-256 in plain JavaScript. Only used with servers that still require
 * a clip digest; current servers analyze the recording without one.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function sha256Hex(data: Uint8Array) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const length = data.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

/** The detected person path for an event, without hashing the clip on the phone when possible. */
async function fetchTrack(incident: string, observation: string, clip: File) {
  const path = `/v1/incidents/${encodeURIComponent(incident)}/observations/${encodeURIComponent(observation)}/track`;
  try {
    return await request<Track>(path, "GET", undefined, 150000);
  } catch (problem) {
    // Older servers insist on a digest of the clip being played.
    if (!(problem instanceof ApiError) || problem.status !== 422) throw problem;
    const digest = sha256Hex(new Uint8Array(await clip.arrayBuffer()));
    return request<Track>(`${path}?clip_digest=${digest}`, "GET", undefined, 150000);
  }
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
    fetchTrack(incident, observation, clip)
      .then((value) => {
        if (!live) return;
        setTrack(value);
        callbacks.current.onTrack(value);
      })
      // Server messages are written for people; anything else (a device or
      // network failure) gets a plain sentence, never a raw exception.
      .catch((problem) => live && setTrackError(problem instanceof ApiError && problem.status < 500 && problem.status !== 422
        ? problem.message
        : "Movement tracking isn’t available for this clip right now. The video still plays."));
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
