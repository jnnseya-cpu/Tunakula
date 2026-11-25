/**
 * Persistence for the app-release gate (`platform.app_release`). Platform-wide, not tenant-scoped, so these run in
 * a plain transaction — there is one supported-version floor per app+platform across every market.
 */
import type { Sql } from "../db/db.ts";
import type { AppId, AppPlatform } from "../modules/appversion/app-version.ts";

export type AppRelease = {
  readonly app: AppId;
  readonly platform: AppPlatform;
  readonly min_supported: string;
  readonly latest: string;
  readonly store_url: string;
  readonly mandatory: boolean;
  readonly message: string;
  readonly updated_by: string;
  readonly updated_at: string;
};

const COLS = "app, platform, min_supported, latest, store_url, mandatory, message, updated_by, updated_at::text AS updated_at";

/** Every configured release floor, ordered for stable display. */
export async function listReleases(sql: Sql): Promise<AppRelease[]> {
  return sql.query<AppRelease>(`SELECT ${COLS} FROM platform.app_release ORDER BY app, platform`);
}

/** The floor for one app+platform, or null when none is configured (then the gate treats the client as current). */
export async function getRelease(sql: Sql, app: AppId, platform: AppPlatform): Promise<AppRelease | null> {
  const [row] = await sql.query<AppRelease>(`SELECT ${COLS} FROM platform.app_release WHERE app = $1 AND platform = $2`, [app, platform]);
  return row ?? null;
}

export interface UpsertReleaseInput {
  readonly app: AppId;
  readonly platform: AppPlatform;
  readonly min_supported: string;
  readonly latest?: string;
  readonly store_url?: string;
  readonly mandatory?: boolean;
  readonly message?: string;
  readonly updated_by: string;
}

/** Create or replace the floor for an app+platform. */
export async function upsertRelease(sql: Sql, input: UpsertReleaseInput): Promise<AppRelease> {
  const [row] = await sql.query<AppRelease>(
    `INSERT INTO platform.app_release (app, platform, min_supported, latest, store_url, mandatory, message, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (app, platform) DO UPDATE SET
       min_supported = EXCLUDED.min_supported, latest = EXCLUDED.latest, store_url = EXCLUDED.store_url,
       mandatory = EXCLUDED.mandatory, message = EXCLUDED.message, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING ${COLS}`,
    [input.app, input.platform, input.min_supported, input.latest ?? "", input.store_url ?? "", input.mandatory ?? false, input.message ?? "", input.updated_by],
  );
  return row!;
}
