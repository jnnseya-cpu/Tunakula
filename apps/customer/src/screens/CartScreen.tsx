import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { randomUUID } from "expo-crypto";
import { placeOrder, quoteCart, type CartItemInput } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { OrderType, PaymentMode, Quote } from "../api/types";
import { useCart } from "../state/cart";
import { formatMoney, sum, times } from "../format";
import { Button, Card, Center, ErrorText, Pill } from "../ui";
import { colors, font, radius, space } from "../theme";
import type { Screen } from "../navigation";

const PAYMENTS: { mode: PaymentMode; label: string }[] = [
  { mode: "MOBILE_MONEY_PUSH", label: "Mobile money" },
  { mode: "CASH_ON_DELIVERY", label: "Cash" },
  { mode: "WALLET", label: "Wallet" },
];

export default function CartScreen({ navigation }: Screen<"Cart">) {
  const cart = useCart();
  const [orderType, setOrderType] = useState<OrderType>("DELIVERY");
  const [payment, setPayment] = useState<PaymentMode>("MOBILE_MONEY_PUSH");
  const [msisdn, setMsisdn] = useState("");
  const [note, setNote] = useState("");
  const [place, setPlace] = useState<{ lat: number; lng: number } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; sig: string } | null>(null);

  // Optimistic local subtotal (the server quote is authoritative once it lands).
  const localSubtotal = cart.lines.length
    ? sum(cart.lines.map((l) => times(l.unitPrice, l.quantity)), cart.lines[0]!.unitPrice.currency)
    : null;

  const items: CartItemInput[] = cart.lines.map((l) => ({
    item_id: l.itemId,
    quantity: l.quantity,
    ...(l.options.length ? { options: l.options } : {}),
    ...(l.addons.length ? { addons: l.addons } : {}),
  }));

  // Get a delivery fix once when delivering.
  useEffect(() => {
    if (orderType !== "DELIVERY") return;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        const granted = perm.granted ? perm : await Location.requestForegroundPermissionsAsync();
        if (granted.granted) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        setPlace(null);
      }
    })();
  }, [orderType]);

  const refreshQuote = useCallback(async () => {
    if (!cart.branchId || items.length === 0) return;
    setQuoteError(null);
    try {
      const q = await quoteCart({
        branch_id: cart.branchId,
        items,
        order_type: orderType,
        ...(orderType === "DELIVERY" && place ? { delivery: place } : {}),
      });
      setQuote(q);
    } catch (e) {
      setQuote(null);
      setQuoteError((e as ApiError).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.branchId, orderType, place, JSON.stringify(items)]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  async function submit() {
    if (!cart.branchId || !quote) return;
    setError(null);
    const due = quote.payable ?? quote.total;
    const sig = `${due.amount_minor}:${orderType}:${payment}`;
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { key: randomUUID(), sig };
    setBusy(true);
    try {
      const placed = await placeOrder(
        {
          branch_id: cart.branchId,
          items,
          order_type: orderType,
          ...(orderType === "DELIVERY" && place ? { delivery: place } : {}),
          payment_mode: payment,
          expected_total: due,
          ...(note.trim() ? { kitchen_note: note.trim() } : {}),
        },
        attempt.current.key,
      );
      cart.clear();
      navigation.replace("Track", { orderId: placed.order_id });
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (cart.lines.length === 0) {
    return (
      <Center>
        <Text style={font.title}>Your cart is empty</Text>
        <Text style={[font.muted, { marginTop: space(2) }]}>Add something tasty to get started.</Text>
        <View style={{ height: space(4) }} />
        <Button title="Browse shops" tone="ghost" onPress={() => navigation.navigate("Home")} />
      </Center>
    );
  }

  const total = quote?.payable ?? quote?.total ?? localSubtotal;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.branch}>{cart.branchName}</Text>

      <Card style={styles.block}>
        {cart.lines.map((l) => (
          <View key={l.key} style={styles.line}>
            <Text style={[font.body, styles.flex]} numberOfLines={1}>{l.name}</Text>
            <View style={styles.qty}>
              <Pressable onPress={() => cart.setQuantity(l.key, l.quantity - 1)} hitSlop={8}><Text style={styles.qtyBtn}>–</Text></Pressable>
              <Text style={styles.qtyNum}>{l.quantity}</Text>
              <Pressable onPress={() => cart.setQuantity(l.key, l.quantity + 1)} hitSlop={8}><Text style={styles.qtyBtn}>+</Text></Pressable>
            </View>
            <Text style={[font.price, styles.linePrice]}>{formatMoney(times(l.unitPrice, l.quantity))}</Text>
          </View>
        ))}
      </Card>

      <Text style={styles.heading}>How would you like it?</Text>
      <View style={styles.chips}>
        {(["DELIVERY", "PICKUP"] as const).map((t) => (
          <Pressable key={t} onPress={() => setOrderType(t)}>
            <Pill label={t === "DELIVERY" ? "Delivery" : "Pick-up"} active={orderType === t} />
          </Pressable>
        ))}
      </View>

      <Text style={styles.heading}>Pay with</Text>
      <View style={styles.chips}>
        {PAYMENTS.map((p) => (
          <Pressable key={p.mode} onPress={() => setPayment(p.mode)}>
            <Pill label={p.label} active={payment === p.mode} />
          </Pressable>
        ))}
      </View>
      {payment === "MOBILE_MONEY_PUSH" ? (
        <TextInput
          style={styles.input}
          value={msisdn}
          onChangeText={setMsisdn}
          keyboardType="phone-pad"
          placeholder="Mobile money number"
          placeholderTextColor={colors.muted}
        />
      ) : null}

      <Text style={styles.heading}>Note for the kitchen</Text>
      <TextInput
        style={[styles.input, { minHeight: 60 }]}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder="Optional — allergies, directions…"
        placeholderTextColor={colors.muted}
      />

      <Card style={[styles.block, { marginTop: space(4) }]}>
        {quote?.price_lines.map((pl) => (
          <View key={pl.code} style={styles.line}>
            <Text style={[font.muted, styles.flex]}>{pl.code.replace(/_/g, " ").toLowerCase()}</Text>
            <Text style={font.body}>{formatMoney(pl.amount)}</Text>
          </View>
        ))}
        <View style={[styles.line, styles.totalLine]}>
          <Text style={[font.title, styles.flex]}>Total</Text>
          <Text style={font.title}>{total ? formatMoney(total) : "…"}</Text>
        </View>
        {quote?.lead_time_required ? <Text style={font.muted}>This shop needs advance notice for delivery.</Text> : null}
      </Card>

      {quoteError ? <ErrorText>{quoteError}</ErrorText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={{ height: space(4) }} />
      <Button
        title={total ? `Place order · ${formatMoney(total)}` : "Place order"}
        onPress={submit}
        busy={busy}
        disabled={!quote}
      />
      <View style={{ height: space(10) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space(4), backgroundColor: colors.paper },
  branch: { ...font.display, fontSize: 22, marginBottom: space(3) },
  block: { gap: space(2) },
  heading: { ...font.display, fontSize: 16, marginTop: space(4), marginBottom: space(2) },
  line: { flexDirection: "row", alignItems: "center", gap: space(2) },
  flex: { flex: 1 },
  linePrice: { minWidth: 72, textAlign: "right" },
  qty: { flexDirection: "row", alignItems: "center", gap: space(3) },
  qtyBtn: { fontSize: 22, fontWeight: "800", color: colors.orange, width: 24, textAlign: "center" },
  qtyNum: { ...font.body, fontWeight: "700", minWidth: 16, textAlign: "center" },
  totalLine: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space(2), marginTop: space(1) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    minHeight: 52,
    fontSize: 16,
    color: colors.ink,
    marginTop: space(2),
  },
});
