import React from "react";
import {
  Text,
  Pressable,
  StyleSheet,
  View,
  type TextProps,
} from "react-native";
import Svg, { Path, Circle } from "react-native-svg";
export const colors = {
  purple: "#5b4fe8",
  ink: "#23253f",
  muted: "#5b6077",
  page: "#f2f3fa",
  border: "#dedff0",
  grass: "#cedfbd",
};
export function Label(props: TextProps) {
  return <Text {...props} style={[styles.text, props.style]} />;
}
export function Button({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && { opacity: 0.5 }]}
    >
      <Label style={styles.buttonText}>{title}</Label>
    </Pressable>
  );
}
export function Card({ children }: React.PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}
export function Mark({ size = 32, color = colors.purple }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path
        d="M16 2.7 26.2 7v8.1c0 6.6-4 11.6-10.2 14.2C9.8 26.7 5.8 21.7 5.8 15.1V7Z M10.4 11.2h11.2v10.1H10.4zm5.6 0v5.2h5.6M10.4 16.4H16"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
      />
      <Circle cx="20.8" cy="20.5" r="2.15" fill={color} />
    </Svg>
  );
}
export const styles = StyleSheet.create({
  text: { fontFamily: "SourceSans", color: colors.ink, fontSize: 16 },
  title: { fontFamily: "SourceSansBold", fontSize: 24, color: colors.ink },
  heading: { fontFamily: "SourceSansBold", fontSize: 19 },
  muted: { color: colors.muted, fontSize: 14 },
  button: {
    backgroundColor: colors.purple,
    borderRadius: 9,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "white", fontFamily: "SourceSansBold", fontSize: 16 },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  input: {
    fontFamily: "SourceSans",
    fontSize: 17,
    color: colors.ink,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 13,
    minHeight: 48,
  },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  error: { color: "#a62336", padding: 12, backgroundColor: "#fff0f1" },
  separator: { height: 1, backgroundColor: colors.border },
});
