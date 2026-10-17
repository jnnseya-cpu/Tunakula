import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { transition } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { KitchenCommand } from "../api/types";
import { formatMoney } from "../format";
import { Button, Card, ErrorText, Pill } from "../ui";
import { colors, font, space } from "../theme";
import { nextAction } from "./BoardScreen";
import type { Screen } from "../navigation";

const REJECT_REASONS = ["OUT_OF_STOCK", "KITCHEN_CLOSED", "TOO_BUSY", "CANNOT_FULFILL"];

export default function OrderScreen({ route, navigation }: Screen<"Order">) {
  const { order } = route.params;
  const [state, setState] = useState(order.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(command: KitchenCommand) {
    setBusy(true);
    setError(null);
    try {
      const r = await transition(order.order_id, command);
      setState(r.state);
      navigation.goBack();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const na = nextAction({ ...order, state });
  const canReject = ["PLACED", "PENDING", "AWAITING_RESTAURANT", "PAID", "SUBMITTED", "ACCEPTED", "CONFIRMED"].includes(state.toUpperCase());

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.rowBetween}>
        <Text style={font.title}>#{order.ref}</Text>
        <Pill label={state.replace(/_/g, " ").toLowerCase()} />
      </View>
      <Text style={font.muted}>
        {order.type.toLowerCase()} · {order.payment_mode === "CASH_ON_DELIVERY" ? "cash" : "prepaid"} · {formatMoney(order.total)}
        {order.customer ? ` · ${order.customer}` : ""}
      </Text>

      <Card style={styles.lines}>
        {order.lines.map((l) => (
          <View key={l.id} style={styles.line}>
            <Text style={styles.qty}>{l.quantity}×</Text>
            <View style={styles.flex}>
              <Text style={font.body}>{l.name}</Text>
              {l.options.length ? <Text style={font.muted}>{l.options.join(", ")}</Text> : null}
              {l.allergens.length ? <Text style={styles.allergen}>Allergens: {l.allergens.join(", ")}</Text> : null}
              {l.note ? <Text style={styles.note}>“{l.note}”</Text> : null}
            </View>
          </View>
        ))}
      </Card>

      {order.kitchen_note ? (
        <Card style={styles.noteCard}>
          <Text style={font.muted}>Customer note</Text>
          <Text style={font.body}>{order.kitchen_note}</Text>
        </Card>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={{ height: space(4) }} />
      {na ? <Button title={na.label} onPress={() => run(na.command)} busy={busy} /> : <Text style={[font.muted, styles.center]}>Waiting for the rider.</Text>}

      {canReject ? (
        <>
          <View style={{ height: space(6) }} />
          <Text style={font.muted}>Can't fulfil this order?</Text>
          <View style={styles.rejectRow}>
            {REJECT_REASONS.map((reason) => (
              <View key={reason} style={styles.flex}>
                <Button title={reason.replace(/_/g, " ").toLowerCase()} tone="ghost" onPress={() => run({ type: "REJECT", reasonCode: reason })} />
              </View>
            ))}
          </View>
        </>
      ) : null}
      <View style={{ height: space(8) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space(4), backgroundColor: colors.paper, gap: space(2) },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  lines: { gap: space(3), marginTop: space(2) },
  line: { flexDirection: "row", gap: space(3) },
  qty: { ...font.body, fontWeight: "800", color: colors.tomato },
  flex: { flex: 1 },
  allergen: { ...font.muted, color: colors.tomato },
  note: { ...font.muted, fontStyle: "italic" },
  noteCard: { marginTop: space(2) },
  center: { textAlign: "center" },
  rejectRow: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) },
});
