/**
 * Grants the first Super Admin (there is nobody yet to grant it through the API).
 *   DATABASE_URL=... node src/db/bootstrap-cli.ts +243810000000 "Display Name"
 * Idempotent; audited. Further roles are granted through the platform.
 */
import { connect } from "./db.ts";
import { addBinding, audit, bindingsOf, createUser, userByPhone } from "../persistence/identity.ts";

const [phone, name = "Super Admin"] = process.argv.slice(2);
if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
  console.error("Usage: node src/db/bootstrap-cli.ts <phone in E.164> [display name]");
  process.exit(2);
}
const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is required");
const db = connect(url, { max: 1 });
try {
  const result = await db.tx({}, async (sql) => {
    const user = (await userByPhone(sql, phone)) ?? (await createUser(sql, { phone, displayName: name }));
    if ((await bindingsOf(sql, user.id)).some((b) => "role" in b && b.role === "SUPER_ADMIN")) return { userId: user.id, granted: false };
    await addBinding(sql, { userId: user.id, role: "SUPER_ADMIN", scope: { type: "GROUP" } });
    await audit(sql, { actor: "bootstrap", action: "role.granted", target: `user:${user.id}`, detail: { role: "SUPER_ADMIN" } });
    return { userId: user.id, granted: true };
  });
  console.log(JSON.stringify(result));
} finally {
  await db.close();
}
