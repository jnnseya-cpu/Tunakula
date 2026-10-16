import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getOrder } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { OrderView } from "../api/types";
import { formatMoney } from "../format";
import { Button, Card, Center, ErrorText } from "../ui";
import { colors, font, space } from "../theme";
import type { Screen } from "../navigation";

// The customer-facing order lifecycle, in order, with friendly labels.
const STEPS: { state: string; label: string }[] = [
  { state: "PLACED", label: "Order placed" },
  { state: "CONFIRMED", label: "Confirmed by the shop" },
  { state: "PREPARING", label: "Being prepared" },
  { state: "READY", label: "Ready" },
  { state: "PICKED_UP", label: "On the way" },
  { state: "DELIVERED", label: "Delivered" },
];

export default function TrackScreen({ route, navigation }: Screen<"Track">) {
  const { orderId } = route.params;
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      getOrder(orderId)
        .then((o) => { if (active) setOrder(o); })
        .catch((e: ApiError) => { if (active) setError(e.message); });
    void load();
    // Poll while the order is live. (Push notifications deliver the same updates to the lock screen; a
    // websocket live-track channel is the next backend increment.)
    const timer = setInterval(load, 8000);
    return () => { active = false; clearInterval(timer); };
  }, [orderId]);

  if (error && !order) return <Center><ErrorText>{error}</ErrorText></Center>;
  if (!order) return <Center><Text style={font.muted}>Loading your order…</Text></Center>;

  const reached = STEPS.findIndex((s) => s.state === order.state);
  const current = reached === -1 ? 0 : reached;
  const cancelled = order.state === "CANCELLED";

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Card style={styles.head}>
        <Text style={font.muted}>{order.branch.name}</Text>
        <Text style={styles.total}>{formatMoney(order.total)}</Text>
        {order.recipient_code ? (
          <View style={styles.codeBox}>
            <Text style={font.muted}>Give the rider this code</Text>
            <Text style={styles.code}>{order.recipient_code}</Text>
          </View>
        ) : null}
      </Card>

      {cancelled ? (
        <Card style={[styles.head, { borderColor: colors.tomato }]}>
          <Text style={[font.title, { color: colors.tomato }]}>Order cancelled</Text>
        </Card>
      ) : (
        <Card>
          {STEPS.map((s, i) => {
            const done = i <= current;
            return (
              <View key={s.state} style={styles.step}>
                <View style={[styles.dot, done && { backgroundColor: colors.good, borderColor: colors.good }]} />
                <Text style={[font.body, done ? styles.stepDone : font.muted]}>{s.label}</Text>
              </View>
            );
          })}
        </Card>
      )}

      <View style={{ height: space(6) }} />
      <Button title="Back to shops" tone="ghost" onPress={() => navigation.navigate("Home")} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space(4), backgroundColor: colors.paper, gap: space(3) },
  head: { gap: space(2) },
  total: { ...font.display, fontSize: 28, color: colors.tomato },
  codeBox: { marginTop: space(2), alignItems: "center", backgroundColor: colors.paper, borderRadius: 14, padding: space(3) },
  code: { fontSize: 34, fontWeight: "900", letterSpacing: 6, color: colors.ink },
  step: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(2) },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card },
  stepDone: { fontWeight: "700", color: colors.ink },
});
