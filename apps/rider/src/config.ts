import Constants from "expo-constants";

/**
 * Runtime configuration, read from app.json's `extra` (overridable per EAS build profile). The API base
 * URL and the market country the build serves. Country isolation is enforced server-side by Row-Level
 * Security on the `x-country` header; the app only has to send it.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; country?: string };

export const API_URL = extra.apiUrl ?? "https://api.tunakula.com";
export const COUNTRY = (extra.country ?? "CD").toUpperCase();
