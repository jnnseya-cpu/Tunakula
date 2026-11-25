/**
 * App-release gate. A public `requirements` lookup tells a client whether it is current, should update, or must
 * update; the admin side lists and sets the per-app+platform floor. This is the cutover kill-switch: at go-live an
 * admin sets `mandatory` with the new minimum, and the onRequest guard (see http/app.ts) then 426s any client below
 * it so retired apps cannot keep hitting this backend.
 *
 * The floor is platform-wide (one per app+platform across all markets), but — as with Integrations — managing it is
 * gated on being a market admin of the active country, reusing the existing authority model rather than inventing a
 * new global role.
 */
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import { getRelease, listReleases, upsertRelease, type AppRelease } from "../persistence/app-release.ts";
import { decide, isAppId, isAppPlatform, parseVersion, type AppId, type AppPlatform, type ReleaseFloor, type UpdateStatus } from "../modules/appversion/app-version.ts";
import { badRequest, forbidden } from "./errors.ts";

export interface Requirements {
  readonly app: AppId;
  readonly platform: AppPlatform;
  readonly status: UpdateStatus;
  readonly min_supported: string;
  readonly latest: string;
  readonly store_url: string;
  readonly mandatory: boolean;
  readonly message: string;
}

function floorOf(r: AppRelease): ReleaseFloor {
  return { min_supported: r.min_supported, latest: r.latest, store_url: r.store_url, mandatory: r.mandatory, message: r.message };
}

export class AppReleaseService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;

  constructor(db: Db, registry: CountryConfigRegistry) {
    this.db = db;
    this.registry = registry;
  }

  #assertOps(principal: Principal, country: string) {
    const v = this.registry.published(country);
    if (!v) throw forbidden("Unknown market");
    if (!authorize(principal, "country_config:write", { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed) {
      throw forbidden("App releases are managed by a market admin");
    }
  }

  /** Public: given a client's app, platform and version, say whether it may proceed, should update, or must update. */
  async requirements(appRaw: unknown, platformRaw: unknown, version: string | null): Promise<Requirements> {
    if (!isAppId(appRaw)) throw badRequest("BAD_APP", "Unknown app");
    if (!isAppPlatform(platformRaw)) throw badRequest("BAD_PLATFORM", "Unknown platform");
    const app = appRaw;
    const platform = platformRaw;
    const row = await this.db.tx({}, (sql) => getRelease(sql, app, platform));
    const floor = row ? floorOf(row) : null;
    return {
      app,
      platform,
      status: decide(version, floor),
      min_supported: row?.min_supported ?? "",
      latest: row?.latest ?? "",
      store_url: row?.store_url ?? "",
      mandatory: row?.mandatory ?? false,
      message: row?.message ?? "",
    };
  }

  /** The raw floor for the enforcement guard — no auth; returns null when none is configured. */
  async floor(app: AppId, platform: AppPlatform): Promise<ReleaseFloor | null> {
    const row = await this.db.tx({}, (sql) => getRelease(sql, app, platform));
    return row ? floorOf(row) : null;
  }

  /** Admin: every configured floor. */
  async list(country: string, principal: Principal): Promise<{ releases: AppRelease[] }> {
    this.#assertOps(principal, country);
    const releases = await this.db.tx({}, (sql) => listReleases(sql));
    return { releases };
  }

  /** Admin: create or replace a floor. Validates the versions so a typo can't silently brick a fleet. */
  async set(country: string, principal: Principal, input: { app?: unknown; platform?: unknown; min_supported?: unknown; latest?: unknown; store_url?: unknown; mandatory?: unknown; message?: unknown }): Promise<{ releases: AppRelease[] }> {
    this.#assertOps(principal, country);
    if (!isAppId(input.app)) throw badRequest("BAD_APP", "Unknown app");
    if (!isAppPlatform(input.platform)) throw badRequest("BAD_PLATFORM", "Unknown platform");
    const app: AppId = input.app;
    const platform: AppPlatform = input.platform;
    const min = String(input.min_supported ?? "").trim();
    if (parseVersion(min) === null) throw badRequest("BAD_VERSION", "min_supported must be a version like 2.0.0");
    const latest = String(input.latest ?? "").trim();
    if (latest && parseVersion(latest) === null) throw badRequest("BAD_VERSION", "latest must be a version like 2.1.0");
    const store_url = String(input.store_url ?? "").trim();
    if (store_url && !/^https?:\/\//i.test(store_url)) throw badRequest("BAD_URL", "store_url must be an http(s) URL");
    await this.db.tx({}, async (sql) => {
      await upsertRelease(sql, { app, platform, min_supported: min, latest, store_url, mandatory: Boolean(input.mandatory), message: String(input.message ?? "").trim().slice(0, 500), updated_by: principal.userId });
      await audit(sql, { actor: principal.userId, action: "app_release.set", target: `app_release:${app}:${platform}`, country, detail: { min_supported: min, mandatory: Boolean(input.mandatory) } });
    });
    return this.list(country, principal);
  }
}
