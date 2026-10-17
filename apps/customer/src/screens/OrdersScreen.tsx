import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { myOrders } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { OrderRow } from "../api/types";
import { useSession } from "../state/session";
import { formatMoney } from "../format";
import { Button, Card, Center, ErrorText, Pill } from "../ui";
import { colors, font, space } from "../theme";
import type { Screen } from "../navigation";

const STATE_LABEL: Record<string, string> = {
  PLACED: "Placed",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY: "Ready",
  PICKED_UP: "On the way",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export default function OrdersScreen({ navigation }: Screen<"Orders">) {
  const { signOut, session } = useSession();
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    myOrders()
      .then(setRows)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) return <Center><ErrorText>{error}</ErrorText></Center>;

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={rows ?? []}
      keyExtractor={(o) => o.order_id}
      ListHeaderComponent={<Text style={styles.who}>{session?.phone}</Text>}
      ListEmptyComponent={
        rows ? <Center><Text style={font.muted}>No orders yet.</Text></Center> : <Center><Text style={font.muted}>Loading…</Text></Center>
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => navigation.navigate("Track", { orderId: item.order_id })}>
          <Card style={styles.card}>
            <View style={styles.row}>
              <Text style={[font.body, styles.flex]} numberOfLines={1}>{item.branch_name}</Text>
              <Pill label={STATE_LABEL[item.state] ?? item.state} active={item.state === "DELIVERED"} />
            </View>
            <View style={styles.row}>
              <Text style={[font.muted, styles.flex]}>{new Date(item.placed_at).toLocaleString()}</Text>
              <Text style={font.price}>{formatMoney(item.total)}</Text>
            </View>
          </Card>
        </Pressable>
      )}
      ListFooterComponent={
        <View style={styles.footer}>
          <Button title="Sign out" tone="ghost" onPress={signOut} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space(4), gap: space(3), backgroundColor: colors.paper, flexGrow: 1 },
  who: { ...font.muted, marginBottom: space(2) },
  card: { gap: space(2) },
  row: { flexDirection: "row", alignItems: "center", gap: space(2) },
  flex: { flex: 1 },
  footer: { marginTop: space(6), marginBottom: space(8) },
});
