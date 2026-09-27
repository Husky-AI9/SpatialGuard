import React, { useEffect, useState } from "react";
import { Image, View } from "react-native";
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
    />
  ) : (
    <Button title="Play recording" onPress={() => setOpen(true)} />
  );
}
function Clip({ uri }: { uri: string }) {
  const [error, setError] = useState("");
  const player = useVideoPlayer({ uri, headers: authHeaders() }, (p) => {
    p.muted = true;
  });
  useEffect(() => {
    const sub = player.addListener("statusChange", (e) => {
      if (e.status === "error")
        setError(
          "Recording unavailable. Return to the incident and try again.",
        );
    });
    return () => sub.remove();
  }, [player]);
  return error ? (
    <Label>{error}</Label>
  ) : (
    <VideoView
      player={player}
      style={{ height: 210, width: "100%" }}
      nativeControls
      contentFit="contain"
    />
  );
}
