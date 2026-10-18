import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Switch, Text, View } from "react-native";
import { kitchenBoard, setBranchStatus, transition } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { KitchenBoard, KitchenCommand, KitchenOrder } from "../api/types";
import { useSession } from "../state/session";
import { formatMoney } from "../format";
import { Button, Card, Center, ErrorText, Pill } from "../ui";
import { colors, font, space } from "../theme";
import type { Screen } from "../navigation";

/** The next positive action a kitchen takes on an order, from its state. Reject lives on the order screen. */
export function nextAction(order: KitchenOrder): { label: string; command: KitchenCommand } | null {
  const s = order.state.toUpperCase();
  if (["PLACED", "PENDING", "AWAITING_RESTAURANT", "PAID", "SUBMITTED"].includes(s)) return { label: "Accept", command: { type: "ACCEPT" } };
  if (["ACCEPTED", "CONFIRMED"].includes(s)) return { label: "Start preparing", command: { type: "START_PREPARING" } };
  if (["PREPARING"].includes(s)) {
    return { label: "Mark packed", command: { type: "PACK", confirmedLineIds: order.lines.map((l) => l.id), packageCount: 1, allergenAcknowledged: true } };
  }
  return null; // PACKED / READY / on the way — no kitchen action, or needs the pack-photo flow
}

export default function BoardScreen({ navigation }: Screen<"Board">) {
  const { signOut } = useSession();
  const [board, setBoard] = useState<KitchenBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBoard(await kitchenBoard());
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(load, 8000);
    return () => clearInterval(poll);
  }, [load]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={signOut} hitSlop={10}>
          <Text style={styles.signout}>Sign out</Text>
        </Pressable>
      ),
    });
  }, [navigation, signOut]);

  async function act(order: KitchenOrder) {
    const na = nextAction(order);
    if (!na) return;
    setBusyId(order.order_id);
    try {
      await transition(order.order_id, na.command);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusyId(null);
    }
  }

  async function togglePause(branchId: string, open: boolean) {
    try {
      await setBranchStatus(branchId, open);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  if (error && !board) return <Center><ErrorText>{error}</ErrorText></Center>;
  if (!board) return <Center><Text style={font.muted}>Loading the board…</Text></Center>;

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={board.orders}
      keyExtractor={(o) => o.order_id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.orange} />}
      ListHeaderComponent={
        <View style={styles.branches}>
          {board.branches.map((b) => (
            <Card key={b.id} style={styles.branchRow}>
              <View style={styles.flex}>
                <Text style={font.body}>{b.name}</Text>
                <Text style={font.muted}>{b.status === "OPEN" ? "Taking orders" : "Paused"}</Text>
              </View>
              {b.can_pause ? (
                <Switch value={b.status === "OPEN"} onValueChange={(open) => togglePause(b.id, open)} trackColor={{ true: colors.good }} thumbColor={colors.card} />
              ) : null}
            </Card>
          ))}
        </View>
      }
      ListEmptyComponent={<Center><Text style={font.muted}>No orders right now.</Text></Center>}
      renderItem={({ item }) => {
        const na = nextAction(item);
        return (
          <Pressable onPress={() => navigation.navigate("Order", { order: item })}>
            <Card style={styles.orderCard}>
              <View style={styles.rowBetween}>
                <Text style={font.title}>#{item.ref}</Text>
                <Pill label={item.state.replace(/_/g, " ").toLowerCase()} active={na?.label === "Accept"} />
              </View>
              <Text style={font.muted}>
                {item.lines.reduce((n, l) => n + l.quantity, 0)} item{item.lines.length !== 1 ? "s" : ""}
                {item.customer ? ` · ${item.customer}` : ""} · {formatMoney(item.total)}
              </Text>
              <Text style={font.body} numberOfLines={2}>{item.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}</Text>
              {item.kitchen_note ? <Text style={styles.note}>Note: {item.kitchen_note}</Text> : null}
              {na ? <View style={{ marginTop: space(2) }}><Button title={na.label} onPress={() => act(item)} busy={busyId === item.order_id} /></View> : null}
            </Card>
          </Pressable>
        );
      }}
      ListFooterComponent={error ? <ErrorText>{error}</ErrorText> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space(4), gap: space(3), backgroundColor: colors.paper, flexGrow: 1 },
  branches: { gap: space(2), marginBottom: space(2) },
  branchRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  flex: { flex: 1 },
  orderCard: { gap: space(1) },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  note: { ...font.muted, color: colors.tomato },
  signout: { color: colors.ink, fontWeight: "700", fontSize: 15 },
});
