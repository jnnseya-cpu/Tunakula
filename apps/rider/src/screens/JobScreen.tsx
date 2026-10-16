import React, { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { transition } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { RiderCommand } from "../api/types";
import { formatMoney } from "../format";
import { Button, Card, ErrorText } from "../ui";
import { colors, font, radius, space } from "../theme";
import type { Screen } from "../navigation";

async function here(): Promise<{ lat: number; lng: number }> {
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

export default function JobScreen({ route, navigation }: Screen<"Job">) {
  const { job } = route.params;
  const [state, setState] = useState(job.state);
  const [code, setCode] = useState("");
  const [failReason, setFailReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Before pick-up the destination is the kitchen; after, it's the customer.
  const pickedUp = state === "PICKED_UP" || state === "ARRIVED_AT_DROP";
  const dest = pickedUp ? job.drop : job.pickup;

  function navigateTo() {
    if (!dest) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`;
    void Linking.openURL(url).catch(() => undefined);
  }

  async function run(command: RiderCommand) {
    setBusy(true);
    setError(null);
    try {
      const r = await transition(job.order_id, command);
      setState(r.state);
      if (command.type === "DELIVER" || command.type === "FAIL_DELIVERY") navigation.goBack();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function pickUp() {
    const loc = await here();
    await run({ type: "PICK_UP", scannedLabelIds: job.labels, restaurantConfirmed: true, sealsIntact: true, location: loc });
  }

  async function deliver() {
    if (code.trim().length < 3) {
      setError("Ask the customer for their delivery code.");
      return;
    }
    const loc = await here();
    await run({ type: "DELIVER", scannedLabelId: job.labels[0], location: loc, verification: { method: "CODE", code: code.trim() }, sealIntact: true });
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Card style={styles.head}>
        <Text style={font.muted}>#{job.ref} · {job.items} item{job.items > 1 ? "s" : ""}</Text>
        <Text style={font.title}>{pickedUp ? "Deliver to customer" : `Pick up at ${job.pickup.name}`}</Text>
        {job.earnings ? <Text style={styles.earn}>{formatMoney(job.earnings)}</Text> : null}
        {job.collect ? <Text style={styles.collect}>Collect {formatMoney(job.collect)} cash on delivery</Text> : null}
      </Card>

      <Card style={{ gap: space(1) }}>
        <Text style={font.muted}>{pickedUp ? "Drop-off" : "Pickup"}</Text>
        <Text style={font.body}>
          {pickedUp ? (job.drop?.customer ?? "Customer") : job.pickup.name}
          {!pickedUp && job.pickup.commune ? ` · ${job.pickup.commune}` : ""}
        </Text>
        {pickedUp && job.drop?.note ? <Text style={font.muted}>Note: {job.drop.note}</Text> : null}
        <View style={{ height: space(2) }} />
        <Button title="Navigate" tone="ghost" onPress={navigateTo} />
      </Card>

      <View style={{ height: space(4) }} />

      {!pickedUp ? (
        <Button title="Confirm pick-up" onPress={pickUp} busy={busy} />
      ) : (
        <>
          <Text style={styles.label}>Customer's delivery code</Text>
          <TextInput style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="• • • •" placeholderTextColor={colors.muted} />
          <View style={{ height: space(3) }} />
          <Button title="Confirm delivery" onPress={deliver} busy={busy} />
          <View style={{ height: space(6) }} />
          <Text style={styles.label}>Can't deliver?</Text>
          <TextInput style={styles.input} value={failReason} onChangeText={setFailReason} placeholder="Reason" placeholderTextColor={colors.muted} />
          <View style={{ height: space(2) }} />
          <Button
            title="Report failed delivery"
            tone="ghost"
            onPress={() => { if (failReason.trim()) void run({ type: "FAIL_DELIVERY", reason: failReason.trim() }); else setError("Add a reason first."); }}
          />
        </>
      )}

      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ height: space(8) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space(4), backgroundColor: colors.paper, gap: space(3) },
  head: { gap: space(1) },
  earn: { ...font.display, fontSize: 26, color: colors.tomato },
  collect: { ...font.muted, color: colors.good, fontWeight: "700" },
  label: { ...font.muted, marginBottom: space(2) },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: space(4), minHeight: 52, fontSize: 18, color: colors.ink },
});
