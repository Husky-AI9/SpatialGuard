import React from "react";
import Svg, { Circle, G, Path } from "react-native-svg";

/**
 * Lucide Camera path shared by the web landing page and native map.
 * The path is kept inline so Expo Go does not need a second icon package and
 * the native marker remains visually identical to the web glyph.
 */
export default function CameraIcon({
  size = 20,
  color = "#ffffff",
  x = 0,
  y = 0,
  strokeWidth = 2,
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

/** Group form for placing the same glyph inside an existing SVG scene. */
export function CameraGlyph({
  size = 20,
  color = "#ffffff",
  x = 0,
  y = 0,
  strokeWidth = 2,
}: {
  size?: number;
  color?: string;
  x?: number;
  y?: number;
  strokeWidth?: number;
}) {
  return (
    <G
      transform={`translate(${x} ${y}) scale(${size / 24})`}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <Circle cx="12" cy="13" r="3" />
    </G>
  );
}
