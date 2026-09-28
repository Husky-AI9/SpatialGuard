import React from "react";
import Svg, { Path, Rect, Circle, Ellipse, G, Defs, RadialGradient, Stop, Text as SvgText } from "react-native-svg";
// Same shop, cameras and heat glow as the web mobile landing.
export default function WelcomeArt() {
  return (
    <Svg
      width="100%"
      height={240}
      viewBox="0 0 320 230"
      accessibilityLabel="A shop with two cameras, a visitor path and a heatmap glow at the entrance"
    >
      <Defs>
        <RadialGradient id="heat">
          <Stop offset="0" stopColor="#e5322d" stopOpacity="0.9" />
          <Stop offset="0.38" stopColor="#ff8a1f" stopOpacity="0.65" />
          <Stop offset="0.66" stopColor="#ffd640" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#42aaff" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Ellipse cx="160" cy="203" rx="132" ry="18" fill="#b2cda0" />
      <Path d="M211 178h31l26 42h-83Z" fill="#e7dcca" />
      <Path
        d="M52 101 160 30l108 71v94H52Z"
        fill="#f6f5ff"
        stroke="white"
        strokeWidth="2"
      />
      <Path
        d="m36 105 124-84 124 84-13 12-111-74-111 74Z"
        fill="#343853"
        stroke="white"
        strokeWidth="2"
      />
      <Path d="M222 48h22v39l-22-15Z" fill="#333753" stroke="white" />
      <Path
        d="M56 116h208M56 129h208M56 142h208M56 155h208M56 168h208M56 181h208"
        stroke="#d7d7ed"
      />
      <Rect
        x="68"
        y="120"
        width="80"
        height="75"
        rx="3"
        fill="#dfe8f7"
        stroke="#3b3f66"
        strokeWidth="2"
      />
      <Path d="M108 121v74M69 170h78" stroke="#3b3f66" strokeWidth="2" />
      <Rect x="80" y="132" width="40" height="15" rx="3" fill="#5b4fe8" />
      <SvgText x="100" y="143.2" textAnchor="middle" fill="white" fontSize="9" fontWeight="700" fontFamily="SourceSansBold">
        OPEN
      </SvgText>
      <Path d="M62 104h196l-7 13H69Z" fill="#e8752a" stroke="#b9541a" strokeWidth="1.2" strokeLinejoin="round" />
      <Path
        d="M86 104l-3 13M110 104l-2 13M134 104l-1 13M158 104v13M182 104l1 13M206 104l2 13M230 104l3 13"
        stroke="#fff4ea"
        strokeWidth="5"
        opacity={0.75}
      />
      <Rect
        x="160"
        y="117"
        width="37"
        height="35"
        rx="2"
        fill="#9ed6ed"
        stroke="#696db4"
        strokeWidth="2"
      />
      <Path d="M178.5 118v33M161 134.5h35" stroke="white" strokeWidth="2" />
      <Rect
        x="207"
        y="112"
        width="35"
        height="83"
        rx="3"
        fill="#b98654"
        stroke="#76502f"
        strokeWidth="2"
      />
      <Rect
        x="214"
        y="121"
        width="21"
        height="24"
        rx="2"
        fill="#9dd3e8"
        stroke="white"
      />
      <Circle cx="234" cy="165" r="2.4" fill="#f0c46a" />
      <Path d="M201 195h48" stroke="#8487b6" strokeWidth="3" />
      <Path
        d="M235 93 304 67A76 76 0 0 1 309 145Z M55 137 8 112A69 69 0 0 0 10 177Z"
        fill="#b5adf960"
        stroke="white"
        strokeDasharray="4 5"
      />
      <Path
        d="M304 214c-30-8-48-21-55-30-13-16-31-10-52 1"
        fill="none"
        stroke="#e5a742"
        strokeWidth="4"
        strokeDasharray="5 7"
      />
      {[
        [235, 94],
        [55, 137],
      ].map(([x, y]) => (
        <G key={x} transform={`translate(${x} ${y})`}>
          <Circle r="12" fill="white" stroke="#5b4fe8" strokeWidth="4.2" />
          <Circle r="4.8" fill="#5b4fe8" />
        </G>
      ))}
      <Circle cx="226" cy="202" r="30" fill="url(#heat)" />
      <Circle cx="190" cy="206" r="20" fill="url(#heat)" opacity={0.7} />
      <Circle cx="262" cy="210" r="16" fill="url(#heat)" opacity={0.55} />
    </Svg>
  );
}
