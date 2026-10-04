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

/**
 * ISO 4217 names countries in English capitals ("CONGO (THE DEMOCRATIC REPUBLIC
 * OF THE)"); flags need ISO 3166 alpha-2 codes. Names are matched to CLDR
 * region names after normalisation; the aliases below cover ISO's naming
 * conventions that normalisation cannot (reviewed list, not currency facts).
 */
const ISO_NAME_ALIASES: Readonly<Record<string, string>> = {
  "BONAIRE, SINT EUSTATIUS AND SABA": "BQ",
  "BRUNEI DARUSSALAM": "BN",
  "CABO VERDE": "CV",
  "CONGO (THE DEMOCRATIC REPUBLIC OF THE)": "CD",
  "CONGO (THE)": "CG",
  "FALKLAND ISLANDS (THE) [MALVINAS]": "FK",
  "HEARD ISLAND AND McDONALD ISLANDS": "HM",
  "HOLY SEE (THE)": "VA",
  "HONG KONG": "HK",
  "KOREA (THE DEMOCRATIC PEOPLE’S REPUBLIC OF)": "KP",
  "KOREA (THE REPUBLIC OF)": "KR",
  "LAO PEOPLE’S DEMOCRATIC REPUBLIC (THE)": "LA",
  "MACAO": "MO",
  "MYANMAR": "MM",
  "PITCAIRN": "PN",
  "RUSSIAN FEDERATION (THE)": "RU",
  "SAINT HELENA, ASCENSION AND TRISTAN DA CUNHA": "SH",
  "SAINT MARTIN (FRENCH PART)": "MF",
  "SYRIAN ARAB REPUBLIC": "SY",
  "UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND (THE)": "GB",
  "UNITED STATES MINOR OUTLYING ISLANDS (THE)": "UM",
  "UNITED STATES OF AMERICA (THE)": "US",
  "VIET NAM": "VN",
  "VIRGIN ISLANDS (BRITISH)": "VG",
  "VIRGIN ISLANDS (U.S.)": "VI",
};

const normaliseName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\(THE\)/g, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\bST\b/g, "SAINT")
    .replace(/\b(THE|OF|AND)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const regionIndex = new Map<string, string>();
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    // Skip retired codes (DY→BJ, HV→BF, TP→TL…): only canonical regions get flags.
    const canonical = Intl.getCanonicalLocales(`und-${code}`)[0]?.split("-")[1];
    const name = regionNames.of(code);
    if (canonical === code && name && name !== code) regionIndex.set(normaliseName(name), code);
  }
}
const unmatched = new Set<string>();
const alpha2 = (isoName: string): string | undefined => {
  const name = isoName.trim();
  if (/^ZZ\d|INTERNATIONAL MONETARY FUND|AFRICAN DEVELOPMENT BANK|SUCRE/.test(name)) return undefined; // not a country
  const code = ISO_NAME_ALIASES[name] ?? regionIndex.get(normaliseName(name)) ?? regionIndex.get(normaliseName(name.replace(/\(.*\)/, "").split(",")[0] ?? ""));
  if (!code) unmatched.add(name);
  return code;
};

const tag = (entry: string, name: string): string | undefined =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(entry)?.[1]?.trim();

const byCode = new Map<string, { code: string; numericCode: string; name: string; minorUnits: number; countries: string[] }>();
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
  const country = alpha2(tag(entry, "CtryNm") ?? "");
  const existing = byCode.get(code);
  if (existing) {
    if (country && !existing.countries.includes(country)) existing.countries.push(country);
    continue;
  }
  byCode.set(code, { code, numericCode, name, minorUnits, countries: country ? [country] : [] });
}

if (unmatched.size) {
  throw new Error(`ISO country names with no ISO 3166 code — add them to ISO_NAME_ALIASES:\n${[...unmatched].join("\n")}`);
}
const currencies = [...byCode.values()].map((c) => ({ ...c, countries: c.countries.sort() })).sort((a, b) => a.code.localeCompare(b.code));
const target = fileURLToPath(new URL("../data/iso4217.json", import.meta.url));
writeFileSync(
  target,
  `${JSON.stringify({ source: "ISO 4217 List One (SIX)", published, currencies }, null, 2)}\n`,
);
console.log(`Wrote ${currencies.length} currencies (ISO publication ${published}) to ${target}`);
