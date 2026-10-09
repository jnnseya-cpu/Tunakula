/**
 * Role matrix (PRD §8.2). Every binding is scoped; a role may only be bound
 * at the scope types listed for it. Permissions are coarse actions; the
 * conditions on a grant are evaluated against the request in `policy.ts`.
 */

export const SCOPE_TYPES = ["GROUP", "COUNTRY", "CITY", "ZONE", "RESTAURANT_GROUP", "BRANCH", "GLOBAL_IDENTITY"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export type Scope =
  | { readonly type: "GROUP" }
  | { readonly type: "GLOBAL_IDENTITY" }
  | { readonly type: "COUNTRY"; readonly id: string }
  | { readonly type: "CITY" | "ZONE" | "RESTAURANT_GROUP" | "BRANCH"; readonly id: string };

export const ACTIONS = [
  // Platform
  "country:create",
  "brand:create",
  "agent_autonomy:set",
  // Configuration and commercial
  "country_config:write",
  /** Second-person approval for publishes that touch money, pricing, payments or labour (§17, dual control). */
  "country_config:approve",
  "zone:write",
  "restaurant:manage",
  "commission:write",
  "campaign:write",
  /** Define and manage paid customer membership plans (the "Plus" subscription). */
  "membership:manage",
  // Finance
  "ledger:read",
  "fx:manage",
  "settlement:manage",
  "payout:approve",
  "cod_reconciliation:manage",
  "refund:issue",
  // Compliance
  "audit:read",
  "kyc:review",
  "model_governance:manage",
  // Operations and support
  "dispatch:manage",
  "rider:manage",
  "exception:manage",
  "order:read",
  "order:manage",
  "ai_chat:takeover",
  // Restaurant
  "menu:write",
  "price:write",
  "branch:manage",
  "staff:manage",
  "payout:read",
  "analytics:read",
  "ads:manage",
  "availability:write",
  "shift:manage",
  "pos:operate",
  "order:accept",
  "order:prepare",
  "order:handover",
  /** Front-of-house: confirm, seat, complete or decline table bookings for a branch. */
  "reservation:manage",
  // Fleet and rider
  "fleet_rider:manage",
  "earnings:read",
  "job:accept",
  "cash_in_hand:read",
  "document:manage",
  // Point of sale (§12.4, OMN-005): authorisation levels per staff member
  "pos:discount",
  "pos:void",
  "pos:refund",
  "cash_drawer:manage",
  // Account administration (any business account)
  "account_member:manage",
  "access_profile:manage",
  "account_profile:edit",
  "account:delete",
  // Customer
  "order:place",
  "wallet:manage",
  "xbo:send",
  /** Subscribe to, and cancel, one's own paid membership. */
  "membership:subscribe",
  /** Book a table (dine-in reservation) at a restaurant, and cancel one's own booking. */
  "reservation:book",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Extra checks on a grant:
 * - OWN_RESOURCE: the resource belongs to the principal (customer orders, rider earnings…).
 * - OWN_FLEET: the resource belongs to the fleet named on the binding.
 * - WITHIN_SUPPORT_REFUND_LIMIT: amount ≤ the country's support refund limit (§8.2 "refunds ≤ threshold").
 * - MARKET_OPEN: the market is LIVE, or PILOT and the principal is invited.
 */
export type Condition = "OWN_RESOURCE" | "OWN_FLEET" | "WITHIN_SUPPORT_REFUND_LIMIT" | "MARKET_OPEN";

export interface Grant {
  readonly action: Action | "*";
  readonly conditions?: readonly Condition[];
}

export interface RoleDefinition {
  readonly scopes: readonly ScopeType[];
  readonly grants: readonly Grant[];
}

const all = (...actions: Action[]): Grant[] => actions.map((action) => ({ action }));
const when = (conditions: Condition[], ...actions: Action[]): Grant[] => actions.map((action) => ({ action, conditions }));

export const ROLES = {
  SUPER_ADMIN: { scopes: ["GROUP"], grants: [{ action: "*" }] },
  GROUP_FINANCE: {
    scopes: ["GROUP"],
    grants: all("ledger:read", "fx:manage", "settlement:manage", "payout:approve", "order:read"),
  },
  COMPLIANCE_OFFICER: {
    scopes: ["GROUP"],
    grants: all("audit:read", "kyc:review", "model_governance:manage", "ledger:read", "order:read"),
  },
  COUNTRY_ADMIN: {
    scopes: ["COUNTRY"],
    grants: all("country_config:write", "zone:write", "restaurant:manage", "commission:write", "campaign:write", "membership:manage", "order:read", "rider:manage"),
  },
  CITY_OPS: {
    scopes: ["CITY"],
    grants: all("dispatch:manage", "rider:manage", "exception:manage", "order:read", "order:manage"),
  },
  COUNTRY_FINANCE: {
    scopes: ["COUNTRY"],
    grants: all("settlement:manage", "cod_reconciliation:manage", "refund:issue", "ledger:read", "order:read"),
  },
  SUPPORT_AGENT: {
    scopes: ["COUNTRY"],
    grants: [...all("order:read", "order:manage", "ai_chat:takeover"), ...when(["WITHIN_SUPPORT_REFUND_LIMIT"], "refund:issue")],
  },
  RESTAURANT_OWNER: {
    scopes: ["RESTAURANT_GROUP"],
    grants: all(
      "menu:write",
      "price:write",
      "branch:manage",
      "staff:manage",
      "payout:read",
      "analytics:read",
      "ads:manage",
      "availability:write",
      "shift:manage",
      "pos:operate",
      "order:read",
      "order:accept",
      "order:prepare",
      "order:handover",
      "reservation:manage",
    ),
  },
  // A franchisee runs one branch of a brand: full control of their own location (menu, profile, orders),
  // but scoped to that branch, so they never see or touch the brand's other franchises.
  FRANCHISEE: {
    scopes: ["BRANCH"],
    grants: all(
      "menu:write",
      "price:write",
      "branch:manage",
      "payout:read",
      "analytics:read",
      "availability:write",
      "shift:manage",
      "pos:operate",
      "order:read",
      "order:accept",
      "order:prepare",
      "order:handover",
      "reservation:manage",
    ),
  },
  BRANCH_MANAGER: {
    scopes: ["BRANCH"],
    grants: all("availability:write", "shift:manage", "pos:operate", "order:read", "order:accept", "order:prepare", "order:handover", "reservation:manage"),
  },
  KITCHEN_STAFF: { scopes: ["BRANCH"], grants: all("order:accept", "order:prepare", "order:handover") },
  FLEET_PARTNER: {
    scopes: ["COUNTRY"],
    grants: when(["OWN_FLEET"], "fleet_rider:manage", "shift:manage", "earnings:read", "payout:read"),
  },
  RIDER: {
    scopes: ["ZONE"],
    grants: [...all("job:accept"), ...when(["OWN_RESOURCE"], "earnings:read", "cash_in_hand:read", "document:manage")],
  },
  CUSTOMER: {
    scopes: ["GLOBAL_IDENTITY"],
    grants: [...when(["MARKET_OPEN"], "order:place", "xbo:send", "membership:subscribe", "reservation:book"), ...when(["OWN_RESOURCE"], "order:read", "wallet:manage")],
  },
} as const satisfies Record<string, RoleDefinition>;

export type Role = keyof typeof ROLES;

interface BindingBase {
  readonly id: string;
  readonly userId: string;
  readonly scope: Scope;
  /** Required for FLEET_PARTNER and fleet profiles: the fleet this binding manages. */
  readonly fleetId?: string;
  /** The business account this binding comes from, for account-member bindings. */
  readonly accountId?: string;
}

/** A built-in §8.2 role. */
export interface BuiltInRoleBinding extends BindingBase {
  readonly role: Role;
}

/** A per-member access profile defined by a business account (see accounts.ts). */
export interface ProfileRoleBinding extends BindingBase {
  readonly profile: { readonly id: string; readonly name: string; readonly grants: readonly Grant[] };
}

export type RoleBinding = BuiltInRoleBinding | ProfileRoleBinding;

export function bindingGrants(binding: RoleBinding): readonly Grant[] {
  return "role" in binding ? (ROLES[binding.role] as RoleDefinition).grants : binding.profile.grants;
}

export function bindingLabel(binding: RoleBinding): string {
  return "role" in binding ? binding.role : `profile:${binding.profile.name}`;
}

export function scopeKey(scope: Scope): string {
  return "id" in scope ? `${scope.type}:${scope.id}` : scope.type;
}

/** Validates a binding before it is granted (`role.granted`). */
export function assertValidBinding(binding: RoleBinding): void {
  if (!("role" in binding)) {
    if (binding.profile.grants.some((g) => g.conditions?.includes("OWN_FLEET")) && !binding.fleetId) {
      throw new Error("Fleet profile bindings must name a fleet");
    }
    return;
  }
  const definition: RoleDefinition = ROLES[binding.role];
  if (!definition) throw new Error(`Unknown role ${String(binding.role)}`);
  if (!definition.scopes.includes(binding.scope.type)) {
    throw new Error(`${binding.role} cannot be bound at ${binding.scope.type} scope (allowed: ${definition.scopes.join(", ")})`);
  }
  if (binding.scope.type === "COUNTRY" && !/^[A-Z]{2}$/.test(binding.scope.id)) {
    throw new Error(`Invalid country scope "${binding.scope.id}"`);
  }
  if ("id" in binding.scope && binding.scope.id.length === 0) throw new Error("Scope id is required");
  if (binding.role === "FLEET_PARTNER" && !binding.fleetId) throw new Error("FLEET_PARTNER bindings must name a fleet");
}
