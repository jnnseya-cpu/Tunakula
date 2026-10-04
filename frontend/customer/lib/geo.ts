/**
 * Where the customer is, for distance and delivery time on every storefront.
 * Commune centres are approximate (the populated centre of each of Kinshasa's 24 communes); a GPS fix
 * or a dropped pin at checkout always replaces them.
 */
export interface Place { readonly label: string; readonly lat: number; readonly lng: number; readonly source: "gps" | "commune" }

export const COMMUNES: readonly [string, number, number][] = [
  ["Bandalungwa", -4.343, 15.287], ["Barumbu", -4.313, 15.325], ["Bumbu", -4.367, 15.287], ["Gombe", -4.306, 15.305],
  ["Kalamu", -4.345, 15.313], ["Kasa-Vubu", -4.335, 15.3], ["Kimbanseke", -4.44, 15.395], ["Kinshasa", -4.324, 15.313],
  ["Kintambo", -4.326, 15.272], ["Kisenso", -4.415, 15.345], ["Lemba", -4.397, 15.322], ["Limete", -4.36, 15.34],
  ["Lingwala", -4.321, 15.298], ["Makala", -4.372, 15.303], ["Maluku", -4.07, 15.57], ["Masina", -4.385, 15.392],
  ["Matete", -4.385, 15.345], ["Mont-Ngafula", -4.44, 15.27], ["Ndjili", -4.395, 15.372], ["Ngaba", -4.383, 15.325],
  ["Ngaliema", -4.36, 15.24], ["Ngiri-Ngiri", -4.348, 15.297], ["Nsele", -4.38, 15.49], ["Selembao", -4.385, 15.275],
];

export const DEFAULT_PLACE: Place = { label: "Gombe", lat: -4.306, lng: 15.305, source: "commune" };

export const communePlace = (name: string): Place | undefined => {
  const c = COMMUNES.find(([n]) => n.toLowerCase() === name.toLowerCase());
  return c ? { label: c[0], lat: c[1], lng: c[2], source: "commune" } : undefined;
};

/** The API that serves live distances and times; unset on the preview site (the shared model is used). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
