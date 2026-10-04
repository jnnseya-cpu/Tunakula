/** Creates an isolated, migrated database for a test run and drops it afterwards. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { connect, type Db } from "./db.ts";
import { migrate } from "./migrate.ts";

export const ADMIN_URL = process.env["TEST_DATABASE_ADMIN_URL"] ?? "postgres://tunakula:tunakula@localhost:5432/postgres";
export const APP_ROLE = process.env["TEST_DATABASE_APP_ROLE"] ?? "tunakula_app";
const APP_PASSWORD = process.env["TEST_DATABASE_APP_PASSWORD"] ?? "tunakula_app";

export async function testDatabase(): Promise<{ db: Db; ownerUrl: string; appUrl: string; drop: () => Promise<void> }> {
  const name = `tunakula_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const ownerUrl = ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
  const url = new URL(ownerUrl);
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  const appUrl = url.toString();
  await migrate(ownerUrl, APP_ROLE);
  const db = connect(appUrl, { max: 5 });
  return {
    db,
    ownerUrl,
    appUrl,
    drop: async () => {
      await db.close();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
