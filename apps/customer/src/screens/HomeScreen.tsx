import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { nearbyBranches } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { NearbyBranch } from "../api/types";
import { useCart } from "../state/cart";
import { Card, Center, ErrorText, Pill } from "../ui";
import { colors, font, space } from "../theme";
import type { Screen } from "../navigation";

// Default to central Kinshasa (Gombe) until the device gives a precise fix, so the list is never empty.
const FALLBACK = { lat: -4.3217, lng: 15.3126 };

const STORE_LABEL: Record<string, string> = {
  RESTAURANT: "Restaurant",
  GROCERY: "Grocery",
  CONVENIENCE: "Shop",
  PHARMACY: "Pharmacy",
  BOUTIQUE: "Boutique",
};

export default function HomeScreen({ navigation }: Screen<"Home">) {
  const { count } = useCart();
  const [branches, setBranches] = useState<NearbyBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    let where = FALLBACK;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      const granted = perm.granted ? perm : await Location.requestForegroundPermissionsAsync();
      if (granted.granted) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        where = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
    } catch {
      // location unavailable — fall back to the city centre
    }
    try {
      setBranches(await nearbyBranches(where.lat, where.lng));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A cart badge button in the header that jumps to checkout.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        count > 0 ? (
          <Pressable onPress={() => navigation.navigate("Cart")} hitSlop={10}>
            <Text style={styles.cartBadge}>Cart · {count}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => navigation.navigate("Orders")} hitSlop={10}>
            <Text style={styles.ordersLink}>Orders</Text>
          </Pressable>
        ),
    });
  }, [navigation, count]);

  if (error && !branches) {
    return (
      <Center>
        <ErrorText>{error}</ErrorText>
        <Text style={[font.muted, { marginTop: space(3) }]} onPress={load}>
          Tap to try again
        </Text>
      </Center>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={branches ?? []}
      keyExtractor={(b) => b.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={colors.orange}
        />
      }
      ListHeaderComponent={<Text style={styles.heading}>Near you</Text>}
      ListEmptyComponent={
        branches ? <Center><Text style={font.muted}>No open shops near you right now.</Text></Center> : <Center><Text style={font.muted}>Finding shops near you…</Text></Center>
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => navigation.navigate("Menu", { branchId: item.id, branchName: item.name })}>
          <Card style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={font.title} numberOfLines={1}>{item.name}</Text>
              <Pill label={item.open ? "Open" : "Closed"} active={item.open} />
            </View>
            <View style={styles.metaRow}>
              <Text style={font.muted}>{STORE_LABEL[item.store_type] ?? item.store_type}</Text>
              {item.commune ? <Text style={font.muted}>· {item.commune}</Text> : null}
              {item.distance_km != null ? <Text style={font.muted}>· {item.distance_km.toFixed(1)} km</Text> : null}
              {item.rating?.average != null ? <Text style={styles.rating}>★ {item.rating.average.toFixed(1)}</Text> : null}
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space(4), gap: space(3), backgroundColor: colors.paper, flexGrow: 1 },
  heading: { ...font.display, fontSize: 24, marginBottom: space(2) },
  card: { gap: space(2) },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5), alignItems: "center" },
  rating: { ...font.muted, color: colors.yellow, fontWeight: "700" },
  cartBadge: { color: colors.tomato, fontWeight: "800", fontSize: 15 },
  ordersLink: { color: colors.ink, fontWeight: "700", fontSize: 15 },
});
