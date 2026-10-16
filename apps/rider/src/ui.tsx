import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { colors, font, radius, space } from "./theme";

/** A warm, rounded primary button in the brand's mango. */
export function Button({ title, onPress, disabled, busy, tone = "brand" }: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "brand" | "ghost";
}) {
  const bg = tone === "brand" ? colors.orange : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: tone === "ghost" ? colors.line : bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tone === "brand" ? colors.onBrand : colors.ink} />
      ) : (
        <Text style={[styles.btnText, { color: tone === "brand" ? colors.onBrand : colors.ink }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** A content card on the cream background. */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Pill({ label, active }: { label: string; active?: boolean }) {
  return (
    <View style={[styles.pill, active && { backgroundColor: colors.tomato, borderColor: colors.tomato }]}>
      <Text style={[styles.pillText, active && { color: colors.onBrand }]}>{label}</Text>
    </View>
  );
}

export function Center({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(5),
  },
  btnText: { fontSize: 16, fontWeight: "700" },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space(4),
  },
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingVertical: space(1.5),
    paddingHorizontal: space(3),
  },
  pillText: { ...font.muted, fontWeight: "600", color: colors.ink },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6), backgroundColor: colors.paper },
  error: { color: colors.tomato, fontSize: 14, marginTop: space(2) },
});
