/** npm run migrate -w @tunakula/api — applies migrations as DATABASE_OWNER_URL and grants DATABASE_APP_ROLE. */
import { migrate } from "./migrate.ts";

const url = process.env["DATABASE_OWNER_URL"];
if (!url) throw new Error("DATABASE_OWNER_URL is required");
const applied = await migrate(url, process.env["DATABASE_APP_ROLE"] ?? "tunakula_app");
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date");
