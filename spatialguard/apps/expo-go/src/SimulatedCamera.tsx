/**
 * The picture for a demo-mode (simulated) camera: a café view with a ticking
 * camera-style clock and a small SIM tag, so it is never mistaken for a Ring
 * feed. Photos: Unsplash License (Nikita Pishchugin, Linh Quach), cropped.
 */
import React, { useEffect, useState } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import { Label } from "./ui";

const seating = require("../assets/sim/seating.jpg");
const windowBar = require("../assets/sim/window-bar.jpg");
export const simulatedPreview = (name: string) => (/window/i.test(name) ? windowBar : seating);

const overlay = { position: "absolute" as const, color: "#fff", fontFamily: "SourceSansBold", fontSize: 13,
  textShadowColor: "rgba(0,0,0,0.75)", textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } };

export default function SimulatedCamera({ name, compact = false, style }: {
  name: string; compact?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (compact) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [compact]);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return (
    <View accessibilityRole="image" accessibilityLabel={`${name}: simulated camera view`}
      style={[{ overflow: "hidden", backgroundColor: "#1c1d22", borderRadius: compact ? 12 : 14 },
        compact ? { width: 56, height: 56 } : { width: "100%", aspectRatio: 16 / 9 }, style]}>
      <Image source={simulatedPreview(name)} resizeMode="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      {!compact && <Label style={[overlay, { top: 10, left: 12 }]}>{name}</Label>}
      {!compact && <Label style={[overlay, { bottom: 10, left: 12, fontVariant: ["tabular-nums"] }]}>{stamp}</Label>}
      <View style={{ position: "absolute", top: compact ? 3 : 8, right: compact ? 3 : 8, paddingHorizontal: compact ? 4 : 6,
        paddingVertical: 1, borderRadius: 6, backgroundColor: "rgba(20,20,24,0.6)" }}>
        <Label style={{ color: "#f1d38a", fontFamily: "SourceSansBold", fontSize: compact ? 8 : 10, letterSpacing: 0.5 }}>SIM</Label>
      </View>
    </View>
  );
}
