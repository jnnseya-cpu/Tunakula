/**
 * Group carts (shared ordering) over PostgreSQL. Tenant tables under country RLS; all reads/writes
 * run inside a `db.tx({ country })`.
 */
import type { Sql } from "../db/db.ts";

export interface GroupCartRow {
  id: string;
  country_iso2: string;
  branch_id: string;
  host_user_id: string;
  code: string;
  status: "OPEN" | "LOCKED" | "PLACED" | "CANCELLED";
  order_type: "DELIVERY" | "TAKEAWAY";
  split_mode: "HOST_PAYS" | "EACH_PAYS";
  deadline: Date | null;
  placed_order_id: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface GroupMemberRow {
  id: string;
  user_id: string;
  display_name: string;
  is_host: boolean;
  joined_at: Date;
}
export interface GroupLineRow {
  id: string;
  member_user_id: string;
  item_id: string;
  quantity: number;
  options: { group: string; choices: string[] }[];
  addons: string[];
  created_at: Date;
}

const CART_COLS = "id, country_iso2, branch_id, host_user_id, code, status, order_type, split_mode, deadline, placed_order_id, created_at, updated_at";

export async function createCart(sql: Sql, c: { country: string; branchId: string; hostUserId: string; code: string; orderType: "DELIVERY" | "TAKEAWAY"; splitMode: "HOST_PAYS" | "EACH_PAYS"; deadline: Date | null }): Promise<GroupCartRow> {
  const [row] = await sql.query<GroupCartRow & Record<string, unknown>>(
    `INSERT INTO ordering.group_cart (country_iso2, branch_id, host_user_id, code, order_type, split_mode, deadline)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${CART_COLS}`,
    [c.country, c.branchId, c.hostUserId, c.code, c.orderType, c.splitMode, c.deadline],
  );
  return row as GroupCartRow;
}

export async function cartById(sql: Sql, id: string): Promise<GroupCartRow | undefined> {
  const [row] = await sql.query<GroupCartRow & Record<string, unknown>>(`SELECT ${CART_COLS} FROM ordering.group_cart WHERE id = $1`, [id]);
  return row;
}
export async function cartByCode(sql: Sql, code: string): Promise<GroupCartRow | undefined> {
  const [row] = await sql.query<GroupCartRow & Record<string, unknown>>(`SELECT ${CART_COLS} FROM ordering.group_cart WHERE code = $1 AND status IN ('OPEN','LOCKED')`, [code]);
  return row;
}
export async function setCartStatus(sql: Sql, id: string, status: GroupCartRow["status"], placedOrderId?: string): Promise<void> {
  await sql.query("UPDATE ordering.group_cart SET status = $2, placed_order_id = COALESCE($3, placed_order_id), updated_at = now() WHERE id = $1", [id, status, placedOrderId ?? null]);
}

export async function addMember(sql: Sql, c: { country: string; cartId: string; userId: string; name: string; host: boolean }): Promise<void> {
  await sql.query(
    `INSERT INTO ordering.group_cart_member (country_iso2, group_cart_id, user_id, display_name, is_host)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (group_cart_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [c.country, c.cartId, c.userId, c.name, c.host],
  );
}
export async function membersOf(sql: Sql, cartId: string): Promise<GroupMemberRow[]> {
  return sql.query<GroupMemberRow & Record<string, unknown>>(
    "SELECT id, user_id, display_name, is_host, joined_at FROM ordering.group_cart_member WHERE group_cart_id = $1 ORDER BY joined_at",
    [cartId],
  );
}
export async function isMember(sql: Sql, cartId: string, userId: string): Promise<boolean> {
  const rows = await sql.query("SELECT 1 FROM ordering.group_cart_member WHERE group_cart_id = $1 AND user_id = $2", [cartId, userId]);
  return rows.length === 1;
}

export async function addLine(sql: Sql, c: { country: string; cartId: string; userId: string; itemId: string; quantity: number; options: unknown; addons: unknown }): Promise<GroupLineRow> {
  const [row] = await sql.query<GroupLineRow & Record<string, unknown>>(
    `INSERT INTO ordering.group_cart_line (country_iso2, group_cart_id, member_user_id, item_id, quantity, options, addons)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, member_user_id, item_id, quantity, options, addons, created_at`,
    [c.country, c.cartId, c.userId, c.itemId, c.quantity, JSON.stringify(c.options ?? []), JSON.stringify(c.addons ?? [])],
  );
  return row as GroupLineRow;
}
export async function removeLine(sql: Sql, cartId: string, lineId: string, userId: string): Promise<boolean> {
  // A member may remove only their own line.
  const rows = await sql.query("DELETE FROM ordering.group_cart_line WHERE id = $1 AND group_cart_id = $2 AND member_user_id = $3 RETURNING id", [lineId, cartId, userId]);
  return rows.length === 1;
}
export async function linesOf(sql: Sql, cartId: string): Promise<GroupLineRow[]> {
  return sql.query<GroupLineRow & Record<string, unknown>>(
    "SELECT id, member_user_id, item_id, quantity, options, addons, created_at FROM ordering.group_cart_line WHERE group_cart_id = $1 ORDER BY created_at",
    [cartId],
  );
}
