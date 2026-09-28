import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

/** Same tokens as the web/Android app (apps/web/src/style.css). */
export const colors = {
  purple: "#5b4fe8",
  purpleDark: "#4f43df",
  purpleSoft: "#eceafd",
  ink: "#23253f",
  muted: "#5b607f",
  page: "#f3f4f9",
  card: "#ffffff",
  border: "#d4d8e8",
  line: "#e3e5f1",
  danger: "#b4232c",
  dangerSoft: "#fdecee",
  grass: "#cedfbd",
};

export function Label(props: TextProps) {
  return <Text {...props} style={[styles.text, props.style]} />;
}

/* Lucide icons (the web app's icon set), drawn with react-native-svg. */
const ICONS: Record<string, string[]> = {
  house: ["M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  history: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"],
  activity: ["M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"],
  settings: ["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"],
  refresh: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  trash: ["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6"],
  pin: ["M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0", "M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"],
  pause: ["M6 5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z", "M14 5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"],
  play: ["M6 4.5v15a1 1 0 0 0 1.5.86l13-7.5a1 1 0 0 0 0-1.72l-13-7.5A1 1 0 0 0 6 4.5z"],
  chevron: ["m9 18 6-6-6-6"],
  back: ["m12 19-7-7 7-7", "M19 12H5"],
  link: ["M9 17H7A5 5 0 0 1 7 7h2", "M15 7h2a5 5 0 1 1 0 10h-2", "M8 12h8"],
  external: ["M7 7h10v10", "M7 17 17 7"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  check: ["M20 6 9 17l-5-5"],
  logout: ["m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"],
  map: ["M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z", "M15 5.764v15", "M9 3.236v15"],
};
export type IconName = keyof typeof ICONS | "camera";

export function Icon({ name, size = 20, color = colors.ink, strokeWidth = 2 }: {
  name: IconName; size?: number; color?: string; strokeWidth?: number;
}) {
  if (name === "camera") return <CameraMark size={size} color={color} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {ICONS[name].map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

/** Pathlight's camera mark: a ring with a centre dot. */
export function CameraMark({ size = 20, color = colors.purple }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={2.6} />
      <Circle cx="12" cy="12" r="3.4" fill={color} />
    </Svg>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
export function Button({
  title,
  onPress,
  disabled = false,
  variant = "primary",
  icon,
  small = false,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
  icon?: IconName;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const tone = {
    primary: { bg: colors.purple, fg: "#ffffff", border: colors.purple },
    secondary: { bg: colors.card, fg: colors.ink, border: colors.border },
    danger: { bg: colors.danger, fg: "#ffffff", border: colors.danger },
    ghost: { bg: "transparent", fg: colors.muted, border: "transparent" },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: pressed && variant === "primary" ? colors.purpleDark : tone.bg, borderColor: tone.border },
        pressed && variant !== "primary" && { backgroundColor: variant === "ghost" ? colors.line : "#f6f6fd" },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={small ? 15 : 17} color={tone.fg} />}
      <Label style={[styles.buttonText, small && { fontSize: 14 }, { color: tone.fg }]}>{title}</Label>
    </Pressable>
  );
}

/** Square outlined icon button, as in the web header. */
export function IconButton({ icon, label, onPress, color = colors.ink, tint }: {
  icon: IconName; label: string; onPress: () => void; color?: string; tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, tint ? { backgroundColor: tint, borderColor: "transparent" } : null, pressed && { backgroundColor: "#f0f0fa" }]}
    >
      <Icon name={icon} size={19} color={color} />
    </Pressable>
  );
}

export function Card({ children, style }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Card title row: heading on the left, a count or action on the right. */
export function CardHeader({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <View style={[styles.row, { justifyContent: "space-between" }]}>
      <View style={{ flex: 1 }}>
        <Label style={styles.heading}>{title}</Label>
        {!!detail && <Label style={[styles.muted, { fontSize: 13 }]}>{detail}</Label>}
      </View>
      {action}
    </View>
  );
}

export function Chip({ text, tone = "accent" }: { text: string; tone?: "accent" | "muted" | "danger" | "success" }) {
  const palette = {
    accent: [colors.purpleSoft, "#4338ca"],
    muted: ["#eef0f6", colors.muted],
    danger: [colors.dangerSoft, colors.danger],
    success: ["#e6f6ec", "#1f7a45"],
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: palette[0] }]}>
      <Label style={[styles.chipText, { color: palette[1] }]}>{text}</Label>
    </View>
  );
}

/** Bottom sheet used for pairing and confirmations. */
export function Sheet({ visible, title, subtitle, onClose, children }: React.PropsWithChildren<{
  visible: boolean; title: string; subtitle?: string; onClose: () => void;
}>) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
        <View style={styles.sheetHandle} />
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1 }}>
            <Label style={styles.heading}>{title}</Label>
            {!!subtitle && <Label style={[styles.muted, { fontSize: 13 }]}>{subtitle}</Label>}
          </View>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        {children}
      </View>
    </Modal>
  );
}

export function Mark({ size = 32, color = colors.purple }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      {/* Pathlight's mark: a walking path that ends in a small light. */}
      <Path d="M5.5 26.5c6 0 6.4-7.4 10.8-7.4s4.6-6.3 8.9-8" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
      <Path d="M25.6 2.9v1.8M31.4 8.6h-1.8M29.7 4.6l-1.3 1.3" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Circle cx="25.6" cy="10.2" r="3.1" fill="#d49431" stroke={color} strokeWidth="1.1" />
      <Circle cx="5.5" cy="26.5" r="1.6" fill={color} />
    </Svg>
  );
}

export const styles = StyleSheet.create({
  text: { fontFamily: "SourceSans", color: colors.ink, fontSize: 16 },
  title: { fontFamily: "SourceSansBold", fontSize: 22, color: colors.ink },
  heading: { fontFamily: "SourceSansBold", fontSize: 18, color: colors.ink },
  strong: { fontFamily: "SourceSansBold", fontSize: 15, color: colors.ink },
  muted: { color: colors.muted, fontSize: 14 },
  button: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  buttonText: { color: "white", fontFamily: "SourceSansBold", fontSize: 16 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  chip: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontFamily: "SourceSansBold", fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  input: {
    fontFamily: "SourceSans",
    fontSize: 17,
    color: colors.ink,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#cfd2e8",
    borderRadius: 10,
    padding: 13,
    minHeight: 48,
  },
  content: { padding: 12, gap: 12, paddingBottom: 28 },
  error: { color: colors.danger, padding: 12, backgroundColor: "#fff4f5", fontSize: 14 },
  separator: { height: 1, backgroundColor: colors.line },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(20,18,18,0.55)" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingTop: 10,
    gap: 14,
    maxHeight: "85%",
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 4 },
});
