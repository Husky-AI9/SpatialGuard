import React from "react";
import Svg, { Circle, G } from "react-native-svg";

/**
 * Pathlight's camera mark: a ring with a centre dot, matching the web app,
 * the floor-plan map markers and the app icon.
 */
export default function CameraIcon({
  size = 20,
  color = "#5b4fe8",
  x = 0,
  y = 0,
  strokeWidth = 2.6,
}: {
  size?: number;
  color?: string;
  x?: number;
  y?: number;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      x={x}
      y={y}
      accessibilityRole="image"
      accessibilityLabel="Camera"
    >
      <CameraGlyph size={24} color={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

/** Group form for placing the same mark inside an existing SVG scene. */
export function CameraGlyph({
  size = 20,
  color = "#5b4fe8",
  fill = "none",
  x = 0,
  y = 0,
  strokeWidth = 2.6,
}: {
  size?: number;
  color?: string;
  fill?: string;
  x?: number;
  y?: number;
  strokeWidth?: number;
}) {
  return (
    <G transform={`translate(${x} ${y}) scale(${size / 24})`}>
      <Circle cx="12" cy="12" r="8.5" fill={fill} stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="12" cy="12" r="3.4" fill={color} />
    </G>
  );
}
