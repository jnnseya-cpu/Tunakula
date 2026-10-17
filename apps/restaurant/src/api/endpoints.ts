import { api } from "./client";
import type { KitchenBoard, KitchenCommand } from "./types";

/** Named calls to the kitchen side of the Tunakula API. */

// ── Auth (phone + OTP) — restaurant staff sign in with their number ──
export const requestOtp = (phone: string, channel: "sms" | "whatsapp", locale = "fr") =>
  api<void>("/v1/auth/otp/request", { method: "POST", auth: false, body: { phone, channel, locale } });

export const verifyOtp = (phone: string, code: string, locale = "fr") =>
  api<{ token: string; user_id: string }>("/v1/auth/otp/verify", { method: "POST", auth: false, body: { phone, code, locale } });

// ── Kitchen board ──
export const kitchenBoard = (branchId?: string) =>
  api<KitchenBoard>(`/v1/kitchen/orders${branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ""}`);

/** Stop or resume taking new orders at a branch (busy, closing early). */
export const setBranchStatus = (branchId: string, open: boolean) =>
  api<{ status: string }>(`/v1/kitchen/branches/${branchId}/status`, { method: "POST", body: { open } });

// ── Order-state transitions issued by the kitchen ──
export const transition = (orderId: string, command: KitchenCommand) =>
  api<{ state: string }>(`/v1/orders/${orderId}/transitions`, { method: "POST", body: { command } });

// ── Native push registration (app = "merchant") ──
export const registerPushDevice = (token: string, platform: "ios" | "android", deviceLabel?: string) =>
  api<{ enabled: boolean }>("/v1/me/push-devices", {
    method: "POST",
    body: { token, app: "merchant", platform, ...(deviceLabel ? { device_label: deviceLabel } : {}) },
  });
