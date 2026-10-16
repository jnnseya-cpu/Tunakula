import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { requestOtp, verifyOtp } from "../api/endpoints";
import { ApiError } from "../api/client";
import { registerForPush } from "../push";
import { useSession } from "../state/session";
import { Button, ErrorText } from "../ui";
import { colors, font, radius, space } from "../theme";

/**
 * Phone + OTP sign-in — the same identity the StackFood apps use, so a migrated customer signs in with the
 * number they already have. Step 1 sends a code (SMS, or WhatsApp where the market prefers it); step 2
 * verifies it and stores the session. First-time numbers can give a display name.
 */
export default function SignInScreen() {
  const { signIn } = useSession();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+243");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = phone.replace(/\s/g, "");

  async function send() {
    setError(null);
    if (!/^\+\d{8,15}$/.test(clean)) {
      setError("Enter your phone number with its country code, e.g. +243 81 000 0000.");
      return;
    }
    setBusy(true);
    try {
      await requestOtp(clean, channel);
      setStep("code");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    if (code.trim().length < 4) {
      setError("Enter the code we sent you.");
      return;
    }
    setBusy(true);
    try {
      const r = await verifyOtp(clean, code.trim(), name.trim() || undefined);
      await signIn({ token: r.token, userId: r.user_id, phone: clean });
      // Best-effort: turn on order notifications. Never blocks sign-in.
      void registerForPush().catch(() => undefined);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.hero}>
          <Text style={styles.wordmark}>Tunakula</Text>
          <Text style={styles.tagline}>Food, groceries and more — delivered across the city.</Text>
        </View>

        <View style={styles.form}>
          {step === "phone" ? (
            <>
              <Text style={styles.label}>Your phone number</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoFocus
                placeholder="+243 81 000 0000"
                placeholderTextColor={colors.muted}
              />
              <View style={styles.channelRow}>
                {(["sms", "whatsapp"] as const).map((c) => (
                  <Text
                    key={c}
                    onPress={() => setChannel(c)}
                    style={[styles.channel, channel === c && styles.channelActive]}
                  >
                    {c === "sms" ? "By SMS" : "By WhatsApp"}
                  </Text>
                ))}
              </View>
              {error ? <ErrorText>{error}</ErrorText> : null}
              <View style={{ height: space(4) }} />
              <Button title="Send me a code" onPress={send} busy={busy} />
            </>
          ) : (
            <>
              <Text style={styles.label}>Enter the code sent to {clean}</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoFocus
                placeholder="• • • •"
                placeholderTextColor={colors.muted}
              />
              <Text style={styles.label}>Your name (first time only)</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Optional"
                placeholderTextColor={colors.muted}
              />
              {error ? <ErrorText>{error}</ErrorText> : null}
              <View style={{ height: space(4) }} />
              <Button title="Sign in" onPress={verify} busy={busy} />
              <View style={{ height: space(2) }} />
              <Button title="Use another number" tone="ghost" onPress={() => { setStep("phone"); setCode(""); setError(null); }} />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1, justifyContent: "space-between" },
  hero: { paddingTop: space(14), paddingHorizontal: space(6), alignItems: "center" },
  wordmark: { fontSize: 40, fontWeight: "900", color: colors.tomato, letterSpacing: -1 },
  tagline: { ...font.muted, textAlign: "center", marginTop: space(2), maxWidth: 280 },
  form: { padding: space(6) },
  label: { ...font.muted, marginBottom: space(2), marginTop: space(3) },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space(4),
    minHeight: 52,
    fontSize: 18,
    color: colors.ink,
  },
  channelRow: { flexDirection: "row", gap: space(2), marginTop: space(3) },
  channel: {
    ...font.muted,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingVertical: space(2),
    paddingHorizontal: space(4),
    overflow: "hidden",
  },
  channelActive: { color: colors.onBrand, backgroundColor: colors.tomato, borderColor: colors.tomato },
});
