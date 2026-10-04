/**
 * Regenerates data/iso4217.json from the official ISO 4217 List One
 * published by SIX (the ISO 4217 maintenance agency).
 *
 * PRD §19.4: the registry is seeded from official ISO 4217 data and never
 * hand-typed. The XML ships inside the `currency-codes` dev dependency,
 * which mirrors SIX's list_one.xml verbatim. To pick up a new ISO
 * publication: bump `currency-codes` (or pass a path to a newer list_one.xml)
 * and re-run `npm run seed:iso4217 -w @tunakula/ts-money`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = process.argv[2] ?? require.resolve("currency-codes/iso-4217-list-one.xml");
const xml = readFileSync(source, "utf8");

const published = /<ISO_4217 Pblshd="([^"]+)"/.exec(xml)?.[1];
if (!published) throw new Error(`${source} is not an ISO 4217 List One file`);

const tag = (entry: string, name: string): string | undefined =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(entry)?.[1]?.trim();

const byCode = new Map<string, { code: string; numericCode: string; name: string; minorUnits: number }>();
for (const [entry] of xml.matchAll(/<CcyNtry>[\s\S]*?<\/CcyNtry>/g)) {
  const code = tag(entry, "Ccy");
  const numericCode = tag(entry, "CcyNbr");
  const name = tag(entry, "CcyNm");
  const minor = tag(entry, "CcyMnrUnts");
  // Skip entries without a currency (e.g. Antarctica), fund codes and
  // instruments without minor units (precious metals, SDR, test codes).
  if (!code || !numericCode || !name || !minor || /IsFund="true"/.test(entry)) continue;
  const minorUnits = Number(minor);
  if (!Number.isInteger(minorUnits)) continue;
  byCode.set(code, { code, numericCode, name, minorUnits });
}

const currencies = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
const target = fileURLToPath(new URL("../data/iso4217.json", import.meta.url));
writeFileSync(
  target,
  `${JSON.stringify({ source: "ISO 4217 List One (SIX)", published, currencies }, null, 2)}\n`,
);
console.log(`Wrote ${currencies.length} currencies (ISO publication ${published}) to ${target}`);
