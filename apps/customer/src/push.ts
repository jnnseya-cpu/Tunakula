import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { registerPushDevice } from "./api/endpoints";

/**
 * Turn on order notifications for this device: ask the OS, get the Expo push token, and register it with
 * the API so the comms engine's `push` channel can reach it (see backend comms.device_push + expoPushSender).
 * Safe to call after sign-in. Returns the token on success, or null if unsupported / declined — the app
 * works fine without push, you just miss live order updates on the lock screen.
 */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null; // the simulator has no push token

  const settings = await Notifications.getPermissionsAsync();
  let status = settings.status;
  if (status !== "granted") {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("orders", {
      name: "Order updates",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#ff7a18",
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const token = tokenResponse.data;

  const platform: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";
  const label = [Device.manufacturer, Device.modelName].filter(Boolean).join(" ") || undefined;
  await registerPushDevice(token, platform, label);
  return token;
}

/** Foreground presentation: show order alerts even while the app is open. */
export function configurePushHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
