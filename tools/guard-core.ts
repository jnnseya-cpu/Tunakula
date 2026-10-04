/**
 * Core-code guard (PRD §7.3, §32.2), run as part of `npm run check`:
 *  1. No market-specific branches in core code ("if country = X").
 *  2. No floating-point parsing or arithmetic helpers in money paths.
 * Adapters and fixtures are exempt from rule 1 — markets differ there by design.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const CORE_DIRS = ["packages/ts-money/src", "packages/ts-contracts/src", "services/api/src"];
const MONEY_DIRS = ["packages/ts-money/src", "services/api/src/modules/money", "services/api/src/modules/payments"];

// e.g. country === "CD", iso2 == 'GB', marketCountry !== "SN", case "CD":
const MARKET_BRANCH = /\b(?:country|iso2|marketCountry|payerCountry|countryCode)\b[\w.?]*\s*[!=]==?\s*["'][A-Z]{2}["']|case\s+["'][A-Z]{2}["']\s*:/;
const FLOAT_IN_MONEY = /\bparseFloat\s*\(|\bMath\.(?:round|floor|ceil|trunc)\s*\(|\btoFixed\s*\(|\bNumber\s*\(\s*(?:amount|price|total|rate|minor)/;

function files(dir: string): string[] {
  const abs = join(root, dir);
  return readdirSync(abs).flatMap((name) => {
    const path = join(abs, name);
    return statSync(path).isDirectory() ? files(relative(root, path)) : path.endsWith(".ts") ? [path] : [];
  });
}

const violations: string[] = [];
const scan = (dirs: string[], pattern: RegExp, rule: string) => {
  for (const file of dirs.flatMap(files)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (pattern.test(line) && !line.includes("guard-core: allow")) violations.push(`${relative(root, file)}:${i + 1} ${rule}: ${line.trim()}`);
    });
  }
};

scan(CORE_DIRS, MARKET_BRANCH, "market-specific branch in core (use the Country Profile or an adapter)");
scan(MONEY_DIRS, FLOAT_IN_MONEY, "floating-point operation in a money path (use @tunakula/ts-money)");

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("guard-core: no market branches in core, no floats in money paths");
