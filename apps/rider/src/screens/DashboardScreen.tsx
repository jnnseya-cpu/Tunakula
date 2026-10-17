import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import * as Location from "expo-location";
import { getJobs, respondOffer, setPresence } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { Jobs } from "../api/types";
import { formatMoney } from "../format";
import { Button, Card, Center, ErrorText, Pill } from "../ui";
import { colors, font, space } from "../theme";
import type { Screen } from "../navigation";

async function fix(): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    const granted = perm.granted ? perm : await Location.requestForegroundPermissionsAsync();
    if (!granted.granted) return undefined;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return undefined;
  }
}

export default function DashboardScreen({ navigation }: Screen<"Dashboard">) {
  const [jobs, setJobs] = useState<Jobs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notRider, setNotRider] = useState(false);
  const [busy, setBusy] = useState(false);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs(await getJobs());
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403 || err.code === "NOT_RIDER") setNotRider(true);
      else setError(err.message);
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(load, 10000); // refresh offers / active jobs
    return () => clearInterval(poll);
  }, [load]);

  const online = jobs?.presence.online ?? false;

  // While online, send a GPS heartbeat so dispatch and the customer's map stay current.
  useEffect(() => {
    if (heartbeat.current) { clearInterval(heartbeat.current); heartbeat.current = null; }
    if (online) {
      heartbeat.current = setInterval(async () => {
        const pos = await fix();
        if (pos) await setPresence(true, pos).catch(() => undefined);
      }, 20000);
    }
    return () => { if (heartbeat.current) clearInterval(heartbeat.current); };
  }, [online]);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const pos = next ? await fix() : undefined;
      await setPresence(next, pos);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function offer(accept: boolean) {
    if (!jobs?.offer) return;
    setBusy(true);
    try {
      await respondOffer(jobs.offer.id, accept);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (notRider) {
    return (
      <Center>
        <Text style={font.title}>Not a rider yet</Text>
        <Text style={[font.muted, { textAlign: "center", marginTop: space(2) }]}>
          This number isn't registered as a Tunakula rider. Your fleet or Tunakula operations adds you after the checks.
        </Text>
      </Center>
    );
  }
  if (!jobs) return <Center><Text style={font.muted}>Loading…</Text></Center>;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Card style={styles.presence}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={font.title}>{online ? "You're online" : "You're offline"}</Text>
            <Text style={font.muted}>{online ? "Receiving job offers" : "Go online to get jobs"}</Text>
          </View>
          <Switch value={online} onValueChange={toggle} disabled={busy} trackColor={{ true: colors.good }} thumbColor={colors.card} />
        </View>
      </Card>

      <View style={styles.statsRow}>
        <Card style={styles.stat}>
          <Text style={styles.statNum}>{jobs.today.deliveries}</Text>
          <Text style={font.muted}>deliveries today</Text>
        </Card>
        <Card style={styles.stat}>
          <Text style={styles.statNum}>{formatMoney(jobs.today.earnings)}</Text>
          <Text style={font.muted}>earned today</Text>
        </Card>
      </View>

      {jobs.offer ? (
        <Card style={styles.offer}>
          <View style={styles.rowBetween}>
            <Text style={font.title}>New job</Text>
            <Pill label={`${jobs.offer.seconds_left}s`} active />
          </View>
          <Text style={font.body}>{jobs.offer.job.pickup.name}{jobs.offer.job.pickup.commune ? ` · ${jobs.offer.job.pickup.commune}` : ""}</Text>
          <Text style={font.muted}>Pickup {jobs.offer.pickup_km} km · drop {jobs.offer.drop_km} km</Text>
          <Text style={[font.price, { marginTop: space(1) }]}>{formatMoney(jobs.offer.earnings)}</Text>
          <View style={styles.offerBtns}>
            <View style={styles.flex}><Button title="Accept" onPress={() => offer(true)} busy={busy} /></View>
            <View style={styles.flex}><Button title="Pass" tone="ghost" onPress={() => offer(false)} /></View>
          </View>
        </Card>
      ) : null}

      <Text style={styles.heading}>Active deliveries</Text>
      {jobs.active.length === 0 ? (
        <Text style={font.muted}>Nothing in progress.</Text>
      ) : (
        jobs.active.map((job) => (
          <Pressable key={job.order_id} onPress={() => navigation.navigate("Job", { job })}>
            <Card style={styles.jobCard}>
              <View style={styles.rowBetween}>
                <Text style={font.body}>#{job.ref}</Text>
                <Pill label={job.state.replace(/_/g, " ").toLowerCase()} />
              </View>
              <Text style={font.muted}>{job.pickup.name} → {job.drop?.customer ?? "customer"}</Text>
              {job.collect ? <Text style={styles.collect}>Collect {formatMoney(job.collect)} cash</Text> : null}
            </Card>
          </Pressable>
        ))
      )}

      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ height: space(6) }} />
      <Button title={`Earnings · ${formatMoney(jobs.cash_in_hand)} in hand`} tone="ghost" onPress={() => navigation.navigate("Earnings")} />
      <View style={{ height: space(8) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space(4), backgroundColor: colors.paper },
  presence: { marginBottom: space(3) },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) },
  statsRow: { flexDirection: "row", gap: space(3), marginBottom: space(3) },
  stat: { flex: 1, alignItems: "center", gap: space(1) },
  statNum: { ...font.display, fontSize: 26, color: colors.tomato },
  offer: { borderColor: colors.orange, gap: space(1), marginBottom: space(3) },
  offerBtns: { flexDirection: "row", gap: space(3), marginTop: space(3) },
  flex: { flex: 1 },
  heading: { ...font.display, fontSize: 18, marginTop: space(2), marginBottom: space(2) },
  jobCard: { gap: space(1), marginBottom: space(2) },
  collect: { ...font.muted, color: colors.good, fontWeight: "700" },
});
