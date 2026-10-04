/**
 * API policy layer (PRD §8.2, §9.5). Deny by default; every decision says
 * which binding allowed it or why it was refused, for audit.
 *
 * Postgres row-level security backs this up in storage; an external engine
 * (OPA/Cedar) can replace `authorize` behind the same signature.
 */
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import { ROLES, scopeKey, type Action, type Condition, type RoleBinding, type RoleDefinition } from "./roles.ts";

/** Where a resource sits in the Country → City → Zone and Restaurant Group → Branch hierarchies. */
export interface ResourceContext {
  readonly type: string;
  /** Tenant = (country, brand). */
  readonly country: string;
  readonly brandId?: string;
  readonly cityId?: string;
  readonly zoneIds?: readonly string[];
  readonly restaurantGroupId?: string;
  readonly branchId?: string;
  readonly ownerUserId?: string;
  readonly fleetId?: string;
}

export interface Principal {
  readonly userId: string;
  readonly bindings: readonly RoleBinding[];
  /** Markets in PILOT the principal has been invited to. */
  readonly pilotInvites?: readonly string[];
}

export interface RequestContext {
  /** From the token / X-Country header (§9.5). The request may only touch this country's data. */
  readonly activeCountry: string;
  /** The Country Profile of `activeCountry`, for country-configured limits. */
  readonly profile: CountryProfile;
  /** Amount involved, for amount-conditioned actions such as refunds. */
  readonly amount?: MoneyJSON;
}

export type Decision =
  | { readonly allowed: true; readonly bindingId: string; readonly role: string }
  | { readonly allowed: false; readonly reason: string };

export function authorize(principal: Principal, action: Action, resource: ResourceContext, request: RequestContext): Decision {
  if (resource.country !== request.activeCountry) {
    return { allowed: false, reason: `resource belongs to ${resource.country}; request is scoped to ${request.activeCountry}` };
  }
  if (request.profile.country.iso2 !== request.activeCountry) {
    return { allowed: false, reason: "request profile does not match the active country" };
  }

  const refusals: string[] = [];
  for (const binding of principal.bindings) {
    if (binding.userId !== principal.userId) continue;
    if (!covers(binding, resource)) continue;
    const definition: RoleDefinition = ROLES[binding.role];
    for (const grant of definition.grants) {
      if (grant.action !== "*" && grant.action !== action) continue;
      const failed = (grant.conditions ?? []).find((c) => !conditionHolds(c, binding, principal, resource, request));
      if (!failed) return { allowed: true, bindingId: binding.id, role: binding.role };
      refusals.push(`${binding.role}@${scopeKey(binding.scope)}: condition ${failed} not met`);
    }
  }
  return { allowed: false, reason: refusals.length > 0 ? refusals.join("; ") : `no binding grants ${action} on this ${resource.type}` };
}

/** Does the binding's scope contain the resource? */
function covers(binding: RoleBinding, resource: ResourceContext): boolean {
  const scope = binding.scope;
  switch (scope.type) {
    case "GROUP":
    case "GLOBAL_IDENTITY":
      return true;
    case "COUNTRY":
      return resource.country === scope.id;
    case "CITY":
      return resource.cityId === scope.id;
    case "ZONE":
      return resource.zoneIds?.includes(scope.id) ?? false;
    case "RESTAURANT_GROUP":
      return resource.restaurantGroupId === scope.id;
    case "BRANCH":
      return resource.branchId === scope.id;
  }
}

function conditionHolds(
  condition: Condition,
  binding: RoleBinding,
  principal: Principal,
  resource: ResourceContext,
  request: RequestContext,
): boolean {
  switch (condition) {
    case "OWN_RESOURCE":
      return resource.ownerUserId !== undefined && resource.ownerUserId === principal.userId;
    case "OWN_FLEET":
      return binding.fleetId !== undefined && resource.fleetId === binding.fleetId;
    case "MARKET_OPEN": {
      const status = request.profile.country.status;
      return status === "LIVE" || (status === "PILOT" && (principal.pilotInvites ?? []).includes(request.activeCountry));
    }
    case "WITHIN_SUPPORT_REFUND_LIMIT": {
      if (!request.amount) return false;
      const amount = Money.fromJSON(request.amount);
      const limit = request.profile.operations.support_refund_limit.find((l) => l.currency === amount.currency);
      // No configured limit for this currency means support cannot refund in it.
      return limit !== undefined && amount.compare(Money.of(limit.amount, amount.currency)) <= 0;
    }
  }
}
