import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { branchMenu } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { Menu, MenuItem } from "../api/types";
import { useCart } from "../state/cart";
import { formatMoney } from "../format";
import { Button, Card, Center, ErrorText, Pill } from "../ui";
import { colors, font, space } from "../theme";
import type { Screen } from "../navigation";

export default function MenuScreen({ route, navigation }: Screen<"Menu">) {
  const { branchId, branchName } = route.params;
  const cart = useCart();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cart.setBranch(branchId, branchName);
    branchMenu(branchId)
      .then(setMenu)
      .catch((e: ApiError) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        cart.count > 0 ? (
          <Pressable onPress={() => navigation.navigate("Cart")} hitSlop={10}>
            <Text style={styles.cartBadge}>Cart · {cart.count}</Text>
          </Pressable>
        ) : null,
    });
  }, [navigation, cart.count]);

  if (error) return <Center><ErrorText>{error}</ErrorText></Center>;
  if (!menu) return <Center><Text style={font.muted}>Loading menu…</Text></Center>;

  const boutiqueLead = menu.branch.store_type === "BOUTIQUE" && (menu.branch.delivery_lead_days ?? 0) > 0;

  // Flatten sections into a single list with section headers for a smooth scroll.
  type Row = { kind: "section"; name: string } | { kind: "item"; item: MenuItem };
  const rows: Row[] = menu.sections.flatMap((s) => [
    { kind: "section" as const, name: s.name },
    ...s.items.map((item) => ({ kind: "item" as const, item })),
  ]);

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={(r, i) => (r.kind === "section" ? `s-${r.name}-${i}` : `i-${r.item.id}`)}
      ListHeaderComponent={
        boutiqueLead ? (
          <Card style={styles.notice}>
            <Text style={font.body}>
              This boutique delivers bigger items. Orders need at least {menu.branch.delivery_lead_days} days' notice.
            </Text>
          </Card>
        ) : null
      }
      renderItem={({ item: row }) =>
        row.kind === "section" ? (
          <Text style={styles.section}>{row.name}</Text>
        ) : (
          <MenuRow item={row.item} onAdd={(addons) => cart.add(row.item, [], addons)} />
        )
      }
      ListFooterComponent={
        cart.count > 0 ? (
          <View style={styles.footer}>
            <Button title={`Review order · ${cart.count} item${cart.count > 1 ? "s" : ""}`} onPress={() => navigation.navigate("Cart")} />
          </View>
        ) : null
      }
    />
  );
}

function MenuRow({ item, onAdd }: { item: MenuItem; onAdd: (addons: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Card style={styles.itemCard}>
      <View style={styles.itemHead}>
        <View style={styles.flex}>
          <Text style={font.body} numberOfLines={1}>{item.name}</Text>
          {item.description ? <Text style={font.muted} numberOfLines={2}>{item.description}</Text> : null}
          <Text style={[font.price, { marginTop: space(1) }]}>{formatMoney(item.price)}</Text>
        </View>
      </View>

      {item.addons && item.addons.length > 0 ? (
        <View style={styles.addonRow}>
          {item.addons.map((a) => (
            <Pressable key={a.id} onPress={() => toggle(a.id)}>
              <Pill label={`${a.name} +${formatMoney(a.price)}`} active={picked.includes(a.id)} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: space(2) }}>
        {item.available ? (
          <Button title="Add" onPress={() => { onAdd(picked); setPicked([]); }} />
        ) : (
          <Pill label="Sold out" />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { padding: space(4), gap: space(3), backgroundColor: colors.paper, flexGrow: 1 },
  section: { ...font.display, fontSize: 20, marginTop: space(3) },
  itemCard: { gap: space(1) },
  itemHead: { flexDirection: "row", gap: space(3) },
  flex: { flex: 1 },
  addonRow: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) },
  notice: { backgroundColor: "#fff2df", borderColor: colors.yellow },
  footer: { marginTop: space(4), marginBottom: space(6) },
  cartBadge: { color: colors.tomato, fontWeight: "800", fontSize: 15 },
});
