/**
 * Pure client-version gate. Given a client's reported version and the release floor for its app+platform, decide
 * whether it is current, should update, or must update. No I/O — the HTTP layer and the enforcement guard both
 * build on this so the rule lives in exactly one place.
 *
 * Versions are plain semver-ish `MAJOR.MINOR.PATCH` strings (extra pre-release/build parts are ignored for the
 * comparison). Anything we cannot parse is treated as "ok" rather than blocked: we never brick a client over a
 * malformed version string — the guard only ever hard-blocks a version we can read and that is clearly below the
 * floor.
 */
export const APP_IDS = ["customer", "restaurant", "rider", "storefront"] as const;
export type AppId = (typeof APP_IDS)[number];
export const APP_PLATFORMS = ["ios", "android", "web"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export type UpdateStatus = "ok" | "update_optional" | "update_required";

export interface ReleaseFloor {
  readonly min_supported: string;
  readonly latest: string;
  readonly store_url: string;
  readonly mandatory: boolean;
  readonly message: string;
}

export function isAppId(v: unknown): v is AppId {
  return typeof v === "string" && (APP_IDS as readonly string[]).includes(v);
}
export function isAppPlatform(v: unknown): v is AppPlatform {
  return typeof v === "string" && (APP_PLATFORMS as readonly string[]).includes(v);
}

/** Parse the leading `MAJOR.MINOR.PATCH` of a version string. Returns null when there is no usable numeric core. */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  if (!m) return null;
  const major = Number(m[1]);
  const minor = m[2] === undefined ? 0 : Number(m[2]);
  const patch = m[3] === undefined ? 0 : Number(m[3]);
  if (![major, minor, patch].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  return [major, minor, patch];
}

/** -1 if a<b, 0 if equal, 1 if a>b. Unparseable operands compare as equal (0) so they never trip a block. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  const [aMaj, aMin, aPatch] = pa;
  const [bMaj, bMin, bPatch] = pb;
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/**
 * Decide the status for a client version against a release floor. A missing floor, or a version we cannot parse,
 * yields "ok". Below `min_supported` -> "update_required"; else below a set `latest` -> "update_optional".
 */
export function decide(clientVersion: string | null | undefined, floor: ReleaseFloor | null): UpdateStatus {
  if (!floor) return "ok";
  if (parseVersion(clientVersion) === null) return "ok";
  const v = clientVersion as string;
  if (compareVersions(v, floor.min_supported) < 0) return "update_required";
  if (floor.latest && compareVersions(v, floor.latest) < 0) return "update_optional";
  return "ok";
}

/** Whether the enforcement guard should hard-block this request: only when the floor is mandatory AND required. */
export function shouldBlock(clientVersion: string | null | undefined, floor: ReleaseFloor | null): boolean {
  return !!floor && floor.mandatory && decide(clientVersion, floor) === "update_required";
}
