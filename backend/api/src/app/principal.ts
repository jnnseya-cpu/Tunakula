/** Resolves who is calling and what they may do (§8.2, §9.5). */
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Sql } from "../db/db.ts";
import { authorize, type Principal, type ResourceContext } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { bindingsOf } from "../persistence/identity.ts";
import { forbidden } from "./errors.ts";

/** Every signed-in person is a customer of the global identity, plus whatever roles they were granted. */
export async function loadPrincipal(sql: Sql, userId: string): Promise<Principal> {
  const bindings = await bindingsOf(sql, userId);
  return {
    userId,
    bindings: [...bindings, { id: `customer:${userId}`, userId, role: "CUSTOMER", scope: { type: "GLOBAL_IDENTITY" } }],
  };
}

export function require(
  principal: Principal,
  action: Action,
  resource: ResourceContext,
  request: { activeCountry: string; profile: CountryProfile; amount?: { currency: string; minor: string } },
): string {
  const decision = authorize(principal, action, resource, request);
  if (!decision.allowed) throw forbidden(decision.reason);
  return decision.role;
}
