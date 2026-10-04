/**
 * Boundary guard, run as part of `npm run check`. The repository has three areas:
 *   shared/   — contracts and primitives both sides use (Money, Currency Registry, Country Profile schema, payment ports)
 *   backend/  — the API, its database and the payment connectors
 *   frontend/ — the website and, later, the apps
 * Allowed dependencies: frontend → shared, backend → shared, shared → shared. Nothing else.
 * The rule is checked twice: in each workspace's package.json and in every import in its source.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const root = new URL("..", import.meta.url).pathname;
type Area = "shared" | "backend" | "frontend";
const AREAS: readonly Area[] = ["shared", "backend", "frontend"];
const ALLOWED: Record<Area, readonly Area[]> = { shared: ["shared"], backend: ["backend", "shared"], frontend: ["frontend", "shared"] };
const SKIP = new Set(["node_modules", ".next", "out", "screenshots", "dist", "coverage"]);
const SOURCE = /\.(?:ts|tsx|mts|js|mjs)$/;

/** Every workspace package: its directory, name and area. */
const workspaces: { dir: string; name: string; area: Area }[] = [];
function findPackages(dir: string, area: Area): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    const manifest = join(path, "package.json");
    if (existsSync(manifest)) workspaces.push({ dir: path, name: JSON.parse(readFileSync(manifest, "utf8")).name, area });
    else findPackages(path, area);
  }
}
for (const area of AREAS) findPackages(join(root, area), area);
const areaOfPackage = new Map(workspaces.map((w) => [w.name, w.area]));

function areaOfPath(abs: string): Area | undefined {
  const top = relative(root, abs).split(/[\\/]/)[0];
  return (AREAS as readonly string[]).includes(top ?? "") ? (top as Area) : undefined;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : SOURCE.test(name) ? [path] : [];
  });
}

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|import\.meta\.resolve\s*\(\s*)["']([^"']+)["']/g;
const violations: string[] = [];

for (const w of workspaces) {
  const manifest = JSON.parse(readFileSync(join(w.dir, "package.json"), "utf8"));
  for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies })) {
    const target = areaOfPackage.get(dep);
    if (target && !ALLOWED[w.area].includes(target)) violations.push(`${relative(root, w.dir)}/package.json: ${w.area} may not depend on ${dep} (${target})`);
  }
  for (const file of sources(w.dir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] as string;
      let target: Area | undefined;
      if (spec.startsWith(".")) target = areaOfPath(resolve(dirname(file), spec));
      else if (spec.startsWith("@tunakula/")) target = areaOfPackage.get(spec.split("/").slice(0, 2).join("/"));
      if (target && !ALLOWED[w.area].includes(target)) {
        const line = text.slice(0, m.index).split("\n").length;
        violations.push(`${relative(root, file)}:${line} ${w.area} may not import ${spec} (${target})`);
      }
    }
  }
}

if (workspaces.length === 0) violations.push("no workspaces found under shared/, backend/ or frontend/");

if (violations.length > 0) {
  console.error(violations.join("\n"));
  console.error(`\n${violations.length} boundary violation(s): frontend and backend depend only on shared; shared depends on nothing else.`);
  process.exit(1);
}
console.log(`guard-boundaries: ${workspaces.length} workspaces (${AREAS.map((a) => `${a} ${workspaces.filter((w) => w.area === a).length}`).join(", ")}) respect shared ← backend / frontend`);
