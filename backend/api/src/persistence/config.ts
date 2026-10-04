/** Persists Country Profile versions (§21 country_profile) and rehydrates the registry at boot. */
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Sql } from "../db/db.ts";
import type { ProfileVersion } from "../modules/config/config-registry.ts";

export async function saveVersions(sql: Sql, versions: readonly ProfileVersion[]): Promise<void> {
  for (const v of versions) {
    await sql.query(
      `INSERT INTO config.country_profile (iso2, version, status, document, created_by, created_at, published_by, published_at, rolled_back_from)
       VALUES ($1,$2,'DRAFT',$3,$4,$5,$6,$7,$8)
       ON CONFLICT (iso2, version) DO NOTHING`,
      [v.iso2, v.version, JSON.stringify(v.profile), v.createdBy, v.createdAt, v.publishedBy ?? null, v.publishedAt ?? null, v.rolledBackFrom ?? null],
    );
  }
  // Status changes in a second pass so the one-published-per-country index never sees two at once.
  for (const v of [...versions].sort((a, b) => (a.status === "PUBLISHED" ? 1 : 0) - (b.status === "PUBLISHED" ? 1 : 0))) {
    await sql.query(
      "UPDATE config.country_profile SET status = $3, document = $4, published_by = $5, published_at = $6 WHERE iso2 = $1 AND version = $2",
      [v.iso2, v.version, v.status, JSON.stringify(v.profile), v.publishedBy ?? null, v.publishedAt ?? null],
    );
  }
}

export async function loadVersions(sql: Sql): Promise<ProfileVersion[]> {
  const rows = await sql.query<{
    iso2: string; version: number; status: ProfileVersion["status"]; document: CountryProfile; created_by: string; created_at: Date;
    published_by: string | null; published_at: Date | null; rolled_back_from: number | null;
  }>("SELECT * FROM config.country_profile ORDER BY iso2, version");
  return rows.map((r) => ({
    iso2: r.iso2,
    version: r.version,
    status: r.status,
    profile: r.document,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at),
    ...(r.published_by ? { publishedBy: r.published_by } : {}),
    ...(r.published_at ? { publishedAt: new Date(r.published_at) } : {}),
    ...(r.rolled_back_from ? { rolledBackFrom: r.rolled_back_from } : {}),
  }));
}
