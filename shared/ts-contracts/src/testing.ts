/**
 * Test fixtures for any workspace (`@tunakula/ts-contracts/testing`). Kept out of the main entry
 * point because it reads files; browsers and the website never import it.
 */
import { readFileSync } from "node:fs";

export type SyntheticMarket = "cd" | "gb" | "sn";

/** The raw synthetic Country Profile document for a §33 test-matrix market (a fresh copy each call). */
export function syntheticProfileDocument(iso2: SyntheticMarket): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`../fixtures/country-profiles/${iso2}.synthetic.json`, import.meta.url), "utf8"));
}
