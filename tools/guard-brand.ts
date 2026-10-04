/**
 * Brand guard, run in `npm run guard`: the Tunakula logo is used exactly as supplied.
 * shared/brand/tunakula-logo.jpg is the master. Every copy (website, favicon) must be
 * byte-identical: no re-encoding, cropping, recolouring or redrawing.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const MASTER = "shared/brand/tunakula-logo.jpg";
/** Copies that must exist. Any other file named tunakula-logo.* anywhere is checked too. */
const REQUIRED = ["frontend/customer/public/brand/tunakula-logo.jpg", "frontend/customer/app/icon.jpg"];
const SKIP = new Set(["node_modules", ".git", ".next", "out", "screenshots", ".preview"]);

const sha = (p: string) => createHash("sha256").update(readFileSync(join(root, p))).digest("hex");
const found: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(join(root, dir))) {
    if (SKIP.has(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (/^tunakula-logo\./i.test(name)) found.push(rel);
  }
})("");

const problems: string[] = [];
let copies: string[] = [];
if (!existsSync(join(root, MASTER))) problems.push(`missing master logo ${MASTER}`);
else {
  const master = sha(MASTER);
  copies = [...new Set([...REQUIRED, ...found])].filter((p) => p !== MASTER);
  for (const p of copies) {
    if (!existsSync(join(root, p))) problems.push(`missing logo copy ${p}`);
    else if (sha(p) !== master) problems.push(`${p} differs from ${MASTER}: the logo must be used exactly as supplied`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`guard-brand: ${copies.length} logo copies identical to ${relative(root, join(root, MASTER))}`);
