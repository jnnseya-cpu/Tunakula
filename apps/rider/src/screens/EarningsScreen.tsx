import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { cashout, getEarnings } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { Earnings } from "../api/types";
import { useSession } from "../state/session";
import { formatMoney } from "../format";
import { Button, Card, Center, ErrorText } from "../ui";
import { colors, font, space } from "../theme";

export default function EarningsScreen() {
  const { signOut } = useSession();
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = () => getEarnings().then(setData).catch((e: ApiError) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function payOut() {
    setBusy(true);
    setError(null);
    try {
      const r = await cashout();
      setDone(`${formatMoney(r.paid)} paid out.`);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <Center><ErrorText>{error}</ErrorText></Center>;
  if (!data) return <Center><Text style={font.muted}>Loading…</Text></Center>;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Card style={styles.balance}>
        <Text style={font.muted}>Available to cash out</Text>
        <Text style={styles.big}>{formatMoney(data.balance)}</Text>
        <View style={{ height: space(3) }} />
        <Button title="Cash out" onPress={payOut} busy={busy} disabled={Number(data.balance.amount_minor) <= 0} />
        {done ? <Text style={styles.done}>{done}</Text> : null}
      </Card>

      <View style={styles.statsRow}>
        <Card style={styles.stat}>
          <Text style={styles.statNum}>{data.today.deliveries}</Text>
          <Text style={font.muted}>today</Text>
          <Text style={font.price}>{formatMoney(data.today.earnings)}</Text>
        </Card>
        {data.week ? (
          <Card style={styles.stat}>
            <Text style={styles.statNum}>{data.week.deliveries}</Text>
            <Text style={font.muted}>this week</Text>
            <Text style={font.price}>{formatMoney(data.week.earnings)}</Text>
          </Card>
        ) : null}
      </View>

      {data.recent && data.recent.length > 0 ? (
        <>
          <Text style={styles.heading}>Recent</Text>
          {data.recent.map((r, i) => (
            <View key={`${r.order_ref}-${i}`} style={styles.row}>
              <Text style={[font.body, styles.flex]}>#{r.order_ref}</Text>
              <Text style={font.muted}>{new Date(r.at).toLocaleDateString()}</Text>
              <Text style={[font.price, { marginLeft: space(3) }]}>{formatMoney(r.amount)}</Text>
            </View>
          ))}
        </>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ height: space(6) }} />
      <Button title="Sign out" tone="ghost" onPress={signOut} />
      <View style={{ height: space(8) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space(4), backgroundColor: colors.paper, gap: space(3) },
  balance: { alignItems: "center" },
  big: { ...font.display, fontSize: 36, color: colors.tomato },
  done: { ...font.muted, color: colors.good, marginTop: space(2) },
  statsRow: { flexDirection: "row", gap: space(3) },
  stat: { flex: 1, alignItems: "center", gap: space(1) },
  statNum: { ...font.display, fontSize: 24, color: colors.ink },
  heading: { ...font.display, fontSize: 18, marginTop: space(2) },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.line },
  flex: { flex: 1 },
});
