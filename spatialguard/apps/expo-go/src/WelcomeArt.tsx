import React from "react";
import Svg, { Path, Rect, Circle, Ellipse, G } from "react-native-svg";
// Same house, cameras and package illustration as the existing mobile landing.
export default function WelcomeArt() {
  return (
    <Svg
      width="100%"
      height={240}
      viewBox="0 0 320 230"
      accessibilityLabel="Home, cameras and a delivered package"
    >
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
        fill="#e9eaf5"
        stroke="#9d9ed0"
        strokeWidth="2"
      />
      <Path
        d="M74 139h68M74 157h68M74 175h68M94 121v74M122 121v74"
        stroke="#c2c3dc"
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
          <Circle r="18" fill="#23253f" stroke="white" strokeWidth="3" />
          <G
            transform="translate(-9 -9) scale(.75)"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <Circle cx="12" cy="13" r="3" />
          </G>
        </G>
      ))}
      <G
        transform="translate(179 164) scale(1.15)"
        stroke="#fff5df"
        strokeWidth="1.2"
      >
        <Path d="m0 8 14-8 15 8-15 8Z" fill="#e8ad4b" />
        <Path d="M0 8v18l14 8V16Z" fill="#b9722e" />
        <Path d="M14 16v18l15-8V8Z" fill="#d88e36" />
        <Path d="m8 3 15 8v7" fill="none" stroke="#7a4b22" strokeWidth="2.2" />
      </G>
    </Svg>
  );
}
