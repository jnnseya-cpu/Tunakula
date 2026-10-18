import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { registerPushDevice } from "./api/endpoints";

/**
 * Turn on job notifications for this device: ask the OS, get the Expo push token, and register it with the
 * API (app = "rider") so the comms engine can push new offers and order updates to the rider. Safe to call
 * after sign-in; the app works without push, you just miss offers on the lock screen.
 */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const settings = await Notifications.getPermissionsAsync();
  let status = settings.status;
  if (status !== "granted") {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("jobs", {
      name: "Job offers",
      importance: Notifications.AndroidImportance.MAX,
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
