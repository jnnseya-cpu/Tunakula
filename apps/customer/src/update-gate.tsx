import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { api, setUpdateRequiredHandler } from "./api/client";
import { APP_ID, APP_PLATFORM, APP_VERSION } from "./config";
import { colors } from "./theme";

/**
 * Cutover update gate. On launch it asks the backend whether this build may keep running; the backend also 426s any
 * request from a build below the mandatory floor. Either signal flips the whole app to a blocking "update required"
 * screen with a button to the store. A failed check never blocks — we only ever block on a definite signal, so a
 * flaky network can't lock a current user out.
 */
interface Requirements {
  readonly status: "ok" | "update_optional" | "update_required";
  readonly store_url: string;
  readonly message: string;
}

export function UpdateGate({ children }: { children: React.ReactNode }) {
  const [blocked, setBlocked] = useState(false);
  const [storeUrl, setStoreUrl] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    // A 426 on any later call also trips the gate.
    setUpdateRequiredHandler(() => { if (alive) setBlocked(true); });
    api<Requirements>(`/v1/app/requirements?app=${APP_ID}&platform=${APP_PLATFORM}&version=${encodeURIComponent(APP_VERSION)}`, { auth: false })
      .then((r) => {
        if (!alive || r.status !== "update_required") return;
        setStoreUrl(r.store_url || "");
        setMessage(r.message || "");
        setBlocked(true);
      })
      .catch(() => { /* never block on a failed check */ });
    return () => { alive = false; };
  }, []);

  if (!blocked) return <>{children}</>;

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: colors.paper, gap: 16 }}>
      <Text style={{ fontSize: 44 }}>⬆️</Text>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink, textAlign: "center" }}>Update required</Text>
      <Text style={{ fontSize: 15, color: colors.muted, textAlign: "center", lineHeight: 22 }}>
        {message || "A new version of Tunakula is needed to continue. Please update to keep using the app."}
      </Text>
      {storeUrl ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => { void Linking.openURL(storeUrl).catch(() => {}); }}
          style={{ backgroundColor: colors.orange, paddingVertical: 14, paddingHorizontal: 30, borderRadius: 999, marginTop: 8 }}
        >
          <Text style={{ color: colors.onBrand, fontWeight: "800", fontSize: 16 }}>Update now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
