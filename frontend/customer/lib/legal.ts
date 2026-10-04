import { CUSTOMER_POLICIES } from "./legal-1";
import { COMPANY_POLICIES, PARTNER_POLICIES, PLATFORM_POLICIES } from "./legal-2";
import type { Policy } from "./legal-types";

export type { Policy } from "./legal-types";

export const POLICY_GROUPS: { readonly title: string; readonly policies: readonly Policy[] }[] = [
  { title: "For customers", policies: CUSTOMER_POLICIES },
  { title: "For partners", policies: PARTNER_POLICIES },
  { title: "Platform rules", policies: PLATFORM_POLICIES },
  { title: "Company", policies: COMPANY_POLICIES },
];

export const ALL_POLICIES: readonly Policy[] = POLICY_GROUPS.flatMap((g) => g.policies);

export function policy(slug: string): Policy | undefined {
  return ALL_POLICIES.find((p) => p.slug === slug);
}

/** Shown on every policy until counsel has reviewed it for each market (PRD §27). */
export const DRAFT_NOTICE =
  "Draft for legal review. This text reflects how Tunakula is designed to work; it is not yet in force and will be reviewed by counsel for each market before launch.";
