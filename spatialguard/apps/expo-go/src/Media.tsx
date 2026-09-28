import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { useVideoPlayer, VideoView } from "expo-video";
import { ORIGIN, authHeaders, type Device } from "./api";
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
export function Recording({
  incident,
  observation,
}: {
  incident: string;
  observation: string;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <Clip
      uri={
        ORIGIN +
        `/v1/incidents/${encodeURIComponent(incident)}/observations/${encodeURIComponent(observation)}/clip`
      }
      name={`${incident}-${observation}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)}
    />
  ) : (
    <Button title="Play recording" onPress={() => setOpen(true)} />
  );
}

/**
 * iOS's player only streams MP4 from servers that answer byte-range requests,
 * and the clip endpoint returns the whole recording at once. So the clip is
 * downloaded into the app's private cache, played from there, and deleted when
 * the player closes.
 */
function Clip({ uri, name }: { uri: string; name: string }) {
  const [local, setLocal] = useState<string | null>(null);
  const [error, setError] = useState("");
  const unplayable = useCallback(() => setError("This recording can't be played on this device."), []);
  useEffect(() => {
    const controller = new AbortController();
    const target = new File(Paths.cache, `recording-${name}.mp4`);
    File.downloadFileAsync(uri, target, { headers: authHeaders(), idempotent: true, signal: controller.signal })
      .then((file) => setLocal(file.uri))
      .catch(() => {
        if (!controller.signal.aborted) setError("Recording unavailable. Return to the incident and try again.");
      });
    return () => {
      controller.abort();
      try {
        if (target.exists) target.delete();
      } catch {
        // The cache is cleared by the system if deletion fails.
      }
    };
  }, [uri, name]);
  if (error) return <Label>{error}</Label>;
  if (!local)
    return (
      <View style={{ height: 210, alignItems: "center", justifyContent: "center", gap: 8 }}>
        <ActivityIndicator color="#5b4fe8" />
        <Label style={styles.muted}>Loading recording…</Label>
      </View>
    );
  return <LocalClip uri={local} onError={unplayable} />;
}

function LocalClip({ uri, onError }: { uri: string; onError: () => void }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.muted = true;
    p.play();
  });
  useEffect(() => {
    const sub = player.addListener("statusChange", (e) => {
      if (e.status === "error") onError();
    });
    return () => sub.remove();
  }, [player, onError]);
  return (
    <VideoView
      player={player}
      style={{ height: 210, width: "100%" }}
      nativeControls
      contentFit="contain"
    />
  );
}
