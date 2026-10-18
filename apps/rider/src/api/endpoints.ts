import { api } from "./client";
import type { Earnings, Jobs, RiderCommand } from "./types";

/** Named calls to the rider side of the Tunakula API, grouped by the rider's shift. */

// ── Auth (phone + OTP) — shared with the customer identity ──
export const requestOtp = (phone: string, channel: "sms" | "whatsapp", locale = "fr") =>
  api<void>("/v1/auth/otp/request", { method: "POST", auth: false, body: { phone, channel, locale } });

export const verifyOtp = (phone: string, code: string, locale = "fr") =>
  api<{ token: string; user_id: string }>("/v1/auth/otp/verify", { method: "POST", auth: false, body: { phone, code, locale } });

// ── Shift ──
export const getJobs = () => api<Jobs>("/v1/rider/jobs");

/** Go online (with a GPS fix) or offline. Online presence is what makes the rider eligible for offers. */
export const setPresence = (online: boolean, pos?: { lat: number; lng: number }) =>
  api<void>("/v1/rider/presence", { method: "POST", body: { online, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) } });

export const respondOffer = (offerId: string, accept: boolean) =>
  api<void>(`/v1/rider/offers/${offerId}/${accept ? "accept" : "decline"}`, { method: "POST", body: {} });

// ── An active job's order-state transitions (pick up, deliver, fail) ──
export const transition = (orderId: string, command: RiderCommand) =>
  api<{ state: string }>(`/v1/orders/${orderId}/transitions`, { method: "POST", body: { command } });

// ── Earnings ──
export const getEarnings = () => api<Earnings>("/v1/rider/earnings");
export const cashout = () => api<{ paid: { amount_minor: string; currency: string } }>("/v1/rider/cashout", { method: "POST", body: {} });

// ── Native push registration (app = "rider") ──
export const registerPushDevice = (token: string, platform: "ios" | "android", deviceLabel?: string) =>
  api<{ enabled: boolean }>("/v1/me/push-devices", {
    method: "POST",
    body: { token, app: "rider", platform, ...(deviceLabel ? { device_label: deviceLabel } : {}) },
  });
