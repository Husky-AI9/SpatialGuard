import React from "react";
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";

/**
 * What Pathlight does, in one picture: Ring cameras on a store floor plan, the
 * people heatmap and one visitor's path from the door to the checkout, and the
 * numbers that come out of it.
 */
const INK = "#23253F";
const PURPLE = "#5B4FE8";
const WALL = "#B9B3F2";
const PATH = "#F2613F";

function Camera({ x, y, from, to }: { x: number; y: number; from: number; to: number }) {
  // A view cone from the camera between two headings (degrees, y down), then the ring-and-dot mark.
  const r = 46;
  const a = (from * Math.PI) / 180, b = (to * Math.PI) / 180;
  const cone = `M${x} ${y}L${x + r * Math.cos(a)} ${y + r * Math.sin(a)}A${r} ${r} 0 0 1 ${x + r * Math.cos(b)} ${y + r * Math.sin(b)}Z`;
  return (
    <G>
      <Path d={cone} fill={PURPLE} opacity={0.12} />
      <Circle cx={x} cy={y} r={8} fill="#FFFFFF" stroke={PURPLE} strokeWidth={3} />
      <Circle cx={x} cy={y} r={3.2} fill={PURPLE} />
    </G>
  );
}

function Label({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <SvgText x={x} y={y} fontSize={9} fontFamily="SourceSansBold" fill="#8387A6" textAnchor="middle" letterSpacing={0.4}>
      {children}
    </SvgText>
  );
}

export default function WelcomeArt() {
  return (
    <Svg
      width="100%"
      height={250}
      viewBox="0 0 320 250"
      accessibilityLabel="A store floor plan with two Ring cameras, a people heatmap, one visitor's path from the door to the checkout, and weekly visit stats"
    >
      <Defs>
        <RadialGradient id="heat">
          <Stop offset="0" stopColor="#E5322D" stopOpacity="0.85" />
          <Stop offset="0.35" stopColor="#FF8A1F" stopOpacity="0.6" />
          <Stop offset="0.65" stopColor="#FFD640" stopOpacity="0.32" />
          <Stop offset="1" stopColor="#42AAFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* The floor-plan card */}
      <Rect x={36} y={26} width={248} height={184} rx={20} fill="#1B1660" opacity={0.18} />
      <Rect x={32} y={20} width={248} height={184} rx={20} fill="#FFFFFF" />
      <Rect x={48} y={36} width={216} height={148} rx={8} fill="#F7F6FF" />

      {/* Heatmap: where people spend time */}
      <Circle cx={104} cy={150} r={34} fill="url(#heat)" />
      <Circle cx={212} cy={146} r={30} fill="url(#heat)" />
      <Circle cx={98} cy={72} r={24} fill="url(#heat)" opacity={0.75} />
      <Circle cx={218} cy={70} r={18} fill="url(#heat)" opacity={0.55} />

      {/* Walls, with the front door gap at the bottom */}
      <Path d="M92 184H48V36H264V184H124" fill="none" stroke={WALL} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1={156} y1={36} x2={156} y2={104} stroke={WALL} strokeWidth={3} strokeLinecap="round" />
      <Line x1={156} y1={116} x2={264} y2={116} stroke={WALL} strokeWidth={3} strokeLinecap="round" />
      <Rect x={190} y={160} width={50} height={9} rx={3} fill="#E4E2FB" />
      <Rect x={70} y={56} width={8} height={36} rx={3} fill="#E4E2FB" />
      <Rect x={116} y={56} width={8} height={36} rx={3} fill="#E4E2FB" />

      <Label x={100} y={50}>AISLES</Label>
      <Label x={212} y={50}>CAFÉ</Label>
      <Label x={214} y={130}>CHECKOUT</Label>
      <Label x={108} y={178}>ENTRANCE</Label>

      {/* One visitor's path: in the door, down the aisles, to the checkout */}
      <Path
        d="M108 200C108 176 104 160 100 140C96 118 98 96 104 84C112 70 140 80 150 98C160 116 176 132 206 144"
        fill="none"
        stroke={PATH}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      <Circle cx={206} cy={144} r={9} fill={PATH} opacity={0.22} />
      <Circle cx={206} cy={144} r={5.5} fill={PATH} stroke="#FFFFFF" strokeWidth={2.5} />

      {/* Ring cameras and their views */}
      <Camera x={58} y={174} from={-80} to={-10} />
      <Camera x={254} y={46} from={100} to={170} />

      {/* What it tells you */}
      <G>
        <Rect x={6} y={4} width={104} height={32} rx={16} fill="#FFFFFF" />
        <Rect x={6} y={4} width={104} height={32} rx={16} fill="none" stroke="#E3E4EF" />
        <Path d="M20 24l5-8 5 8z" fill="#1E7A3C" />
        <SvgText x={36} y={25} fontSize={13} fontFamily="SourceSansBold" fill={INK}>+24% visits</SvgText>
      </G>
      <G>
        <Rect x={196} y={208} width={120} height={38} rx={14} fill="#FFFFFF" />
        <Rect x={196} y={208} width={120} height={38} rx={14} fill="none" stroke="#E3E4EF" />
        {[6, 9, 13, 18, 11].map((h, i) => (
          <Rect key={i} x={208 + i * 7} y={236 - h} width={5} height={h} rx={1.5} fill={i === 3 ? PURPLE : "#C9C3F8"} />
        ))}
        <SvgText x={250} y={224} fontSize={9} fontFamily="SourceSansBold" fill="#5B5E78">BUSIEST</SvgText>
        <SvgText x={250} y={238} fontSize={13} fontFamily="SourceSansBold" fill={INK}>5–7 PM</SvgText>
      </G>
    </Svg>
  );
}
