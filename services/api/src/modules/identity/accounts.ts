/**
 * Accounts, members and access levels.
 *
 * Every business — the platform's own admin organisation, a restaurant group,
 * a supermarket, a fleet company — is a BusinessAccount with any number of
 * members (account holders). Each member holds one or more AccessProfiles
 * (built-in templates or custom ones the business defines) and may be limited
 * to specific branches or countries. Memberships compile into the scoped role
 * bindings that `authorize` (policy.ts) evaluates, so there is one policy path
 * for everyone.
 *
 * Every account, personal or business, has a profile picture, a cover picture
 * and self-service deletion. Deletion pseudonymises personal data but never
 * erases financial records (PRD §19.1 MR-7, §12.4, §27 retention).
 */
import { randomUUID } from "node:crypto";
import type { MoneyJSON } from "@tunakula/ts-money";
import {
  ACTIONS,
  ROLES,
  scopeKey,
  type Action,
  type Condition,
  type Grant,
  type ProfileRoleBinding,
  type RoleDefinition,
  type Scope,
  type ScopeType,
} from "./roles.ts";

// ---------------------------------------------------------------------------
// Types

export type BusinessKind = "PLATFORM" | "MERCHANT" | "FLEET";
export type MerchantCategory = "RESTAURANT" | "SUPERMARKET" | "PHARMACY" | "SHOP" | "OTHER";
export type AccountStatus = "ACTIVE" | "PENDING_DELETION" | "DELETED";
export type ImageSlot = "profile" | "cover";

/** A stored image. Bytes live in object storage; the account keeps the reference. */
export interface ImageRef {
  readonly assetId: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export interface AccountImages {
  readonly profile?: ImageRef;
  readonly cover?: ImageRef;
}

interface DeletionState {
  readonly status: AccountStatus;
  readonly deletionRequestedAt?: Date;
  readonly deletionDueAt?: Date;
  readonly deletedAt?: Date;
}

export interface UserAccount extends DeletionState {
  readonly id: string;
  readonly displayName: string;
  readonly phoneE164?: string;
  readonly email?: string;
  readonly images: AccountImages;
}

export interface BusinessAccount extends DeletionState {
  readonly id: string;
  readonly kind: BusinessKind;
  readonly name: string;
  /** Home market; the platform organisation spans all markets. */
  readonly country?: string;
  readonly category?: MerchantCategory;
  /** Merchant branches, for branch-limited members. */
  readonly branchIds: readonly string[];
  readonly images: AccountImages;
}

export interface AccessProfile {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly grants: readonly Grant[];
  /** Scope types a member holding this profile may be limited to. */
  readonly scopes: readonly ScopeType[];
  /** Owners can delete the account and manage other owners. At least one must remain. */
  readonly owner: boolean;
  readonly builtIn: boolean;
}

export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";

export interface Membership {
  readonly id: string;
  readonly accountId: string;
  readonly userId: string;
  readonly profileIds: readonly string[];
  /** Where this member may act: the whole account, or specific branches/countries/cities. */
  readonly scopes: readonly Scope[];
  readonly status: MembershipStatus;
  readonly invitedBy: string;
}

export interface AuditRecord {
  readonly at: Date;
  readonly actorUserId: string;
  readonly action: string;
  readonly target: string;
  readonly detail?: string;
}

export class AccountError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new AccountError(code, message);
}

// ---------------------------------------------------------------------------
// What each kind of business may grant, and its starter templates

const MERCHANT_ACTIONS: readonly Action[] = [
  "menu:write",
  "price:write",
  "branch:manage",
  "staff:manage",
  "availability:write",
  "shift:manage",
  "order:read",
  "order:accept",
  "order:prepare",
  "order:handover",
  "pos:operate",
  "pos:discount",
  "pos:void",
  "pos:refund",
  "cash_drawer:manage",
  "payout:read",
  "analytics:read",
  "ads:manage",
  "account_member:manage",
  "access_profile:manage",
  "account_profile:edit",
  "account:delete",
];

const FLEET_ACTIONS: readonly Action[] = [
  "fleet_rider:manage",
  "shift:manage",
  "earnings:read",
  "payout:read",
  "account_member:manage",
  "access_profile:manage",
  "account_profile:edit",
  "account:delete",
];

/** Actions only individuals hold for themselves; never grantable through a business account. */
const PERSONAL_ACTIONS: readonly Action[] = ["order:place", "wallet:manage", "xbo:send", "job:accept", "cash_in_hand:read", "document:manage"];

export const GRANTABLE_ACTIONS: Readonly<Record<BusinessKind, readonly Action[]>> = {
  PLATFORM: ACTIONS.filter((a) => !PERSONAL_ACTIONS.includes(a)),
  MERCHANT: MERCHANT_ACTIONS,
  FLEET: FLEET_ACTIONS,
};

const ACCOUNT_WIDE_SCOPE: Readonly<Record<BusinessKind, ScopeType>> = {
  PLATFORM: "GROUP",
  MERCHANT: "RESTAURANT_GROUP",
  FLEET: "COUNTRY",
};

interface Template {
  readonly name: string;
  readonly actions: readonly Action[] | "*";
  readonly scopes: readonly ScopeType[];
  readonly owner?: boolean;
  readonly conditions?: Partial<Record<Action, readonly Condition[]>>;
}

const MERCHANT_SCOPES: readonly ScopeType[] = ["RESTAURANT_GROUP", "BRANCH"];

const role = (name: string, key: keyof typeof ROLES, owner = false): Template => {
  const def: RoleDefinition = ROLES[key];
  return {
    name,
    actions: def.grants.some((g) => g.action === "*") ? "*" : def.grants.map((g) => g.action as Action),
    scopes: def.scopes,
    owner,
    conditions: Object.fromEntries(def.grants.filter((g) => g.conditions).map((g) => [g.action, g.conditions])),
  };
};

export const TEMPLATES: Readonly<Record<BusinessKind, readonly Template[]>> = {
  PLATFORM: [
    role("Super Admin", "SUPER_ADMIN", true),
    role("Group Finance", "GROUP_FINANCE"),
    role("Compliance Officer", "COMPLIANCE_OFFICER"),
    role("Country Admin", "COUNTRY_ADMIN"),
    role("City Ops", "CITY_OPS"),
    role("Country Finance", "COUNTRY_FINANCE"),
    role("Support Agent", "SUPPORT_AGENT"),
  ],
  MERCHANT: [
    { name: "Owner", actions: MERCHANT_ACTIONS, scopes: ["RESTAURANT_GROUP"], owner: true },
    {
      name: "Manager",
      actions: ["branch:manage", "staff:manage", "availability:write", "shift:manage", "order:read", "order:accept", "order:prepare", "order:handover", "pos:operate", "pos:discount", "pos:void", "pos:refund", "cash_drawer:manage", "analytics:read", "account_member:manage"],
      scopes: MERCHANT_SCOPES,
    },
    { name: "Cashier", actions: ["pos:operate", "order:read", "order:handover"], scopes: MERCHANT_SCOPES },
    { name: "Kitchen", actions: ["order:accept", "order:prepare", "order:handover"], scopes: MERCHANT_SCOPES },
    { name: "Accountant", actions: ["payout:read", "analytics:read", "order:read"], scopes: MERCHANT_SCOPES },
    { name: "Marketing", actions: ["ads:manage", "analytics:read", "menu:write", "account_profile:edit"], scopes: MERCHANT_SCOPES },
  ],
  FLEET: [
    { name: "Owner", actions: FLEET_ACTIONS, scopes: ["COUNTRY"], owner: true },
    { name: "Dispatcher", actions: ["fleet_rider:manage", "shift:manage"], scopes: ["COUNTRY"] },
    { name: "Accountant", actions: ["earnings:read", "payout:read"], scopes: ["COUNTRY"] },
  ],
};

// ---------------------------------------------------------------------------
// Images (profile picture and cover picture)

export const IMAGE_RULES: Readonly<Record<ImageSlot, { maxBytes: number; minWidth: number; minHeight: number; minAspect: number; maxAspect: number }>> = {
  profile: { maxBytes: 5 * 1024 * 1024, minWidth: 200, minHeight: 200, minAspect: 0.8, maxAspect: 1.25 },
  cover: { maxBytes: 10 * 1024 * 1024, minWidth: 1200, minHeight: 400, minAspect: 2, maxAspect: 4 },
};
export const IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

export function validateImage(slot: ImageSlot, image: ImageRef): void {
  const rule = IMAGE_RULES[slot];
  if (!image.assetId) fail("IMAGE_INVALID", "Image asset id is required");
  if (!IMAGE_TYPES.includes(image.contentType)) fail("IMAGE_TYPE", `${image.contentType} is not allowed; use JPEG, PNG or WebP`);
  if (image.bytes <= 0 || image.bytes > rule.maxBytes) fail("IMAGE_TOO_LARGE", `The ${slot} picture must be at most ${rule.maxBytes / 1024 / 1024} MB`);
  if (image.width < rule.minWidth || image.height < rule.minHeight) {
    fail("IMAGE_TOO_SMALL", `The ${slot} picture must be at least ${rule.minWidth}×${rule.minHeight}`);
  }
  const aspect = image.width / image.height;
  if (aspect < rule.minAspect || aspect > rule.maxAspect) fail("IMAGE_ASPECT", `The ${slot} picture has the wrong shape`);
}

// ---------------------------------------------------------------------------
// Deletion

/**
 * Port to the contexts that know whether an account can be closed safely.
 * Implemented by Ordering (open orders) and Money (wallets, payables, cash in hand).
 */
export interface DeletionChecks {
  openOrders(subject: DeletionSubject): Promise<number>;
  /** Every non-zero balance owed to or by the subject, per currency. */
  outstandingBalances(subject: DeletionSubject): Promise<readonly MoneyJSON[]>;
}

export interface DeletionSubject {
  readonly type: "USER" | "BUSINESS";
  readonly id: string;
}

export type DeletionBlocker =
  | { readonly code: "OPEN_ORDERS"; readonly count: number }
  | { readonly code: "BALANCE_OUTSTANDING"; readonly amount: MoneyJSON }
  | { readonly code: "SOLE_OWNER"; readonly accountId: string; readonly accountName: string };

export type DeletionOutcome =
  | { readonly status: "BLOCKED"; readonly blockers: readonly DeletionBlocker[] }
  | { readonly status: "SCHEDULED"; readonly dueAt: Date };

export interface DirectoryOptions {
  readonly checks: DeletionChecks;
  /** Grace period during which deletion can be cancelled. */
  readonly deletionGraceDays?: number;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

// ---------------------------------------------------------------------------
// Directory

export class AccountDirectory {
  readonly #users = new Map<string, UserAccount>();
  readonly #accounts = new Map<string, BusinessAccount>();
  readonly #profiles = new Map<string, AccessProfile>();
  readonly #memberships = new Map<string, Membership>();
  readonly #audit: AuditRecord[] = [];
  readonly #checks: DeletionChecks;
  readonly #graceMs: number;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: DirectoryOptions) {
    this.#checks = options.checks;
    this.#graceMs = (options.deletionGraceDays ?? 30) * 86_400_000;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.newId ?? randomUUID;
  }

  // --- Personal accounts ----------------------------------------------------

  registerUser(input: { displayName: string; phoneE164?: string; email?: string }): UserAccount {
    if (!input.displayName.trim()) fail("NAME_REQUIRED", "A display name is required");
    const user: UserAccount = { id: this.#id(), displayName: input.displayName.trim(), ...pick(input, "phoneE164", "email"), images: {}, status: "ACTIVE" };
    this.#users.set(user.id, user);
    return user;
  }

  user(id: string): UserAccount {
    return this.#users.get(id) ?? fail("USER_NOT_FOUND", `No user ${id}`);
  }

  /** A person edits their own pictures. Returns the replaced asset (if any) for storage clean-up. */
  setUserImage(actorUserId: string, slot: ImageSlot, image: ImageRef | null): { replaced?: string } {
    const user = this.#activeUser(actorUserId);
    if (image) validateImage(slot, image);
    const replaced = user.images[slot]?.assetId;
    this.#users.set(user.id, { ...user, images: withImage(user.images, slot, image) });
    this.#log(actorUserId, `user.${slot}_picture.${image ? "set" : "removed"}`, `user:${user.id}`);
    return replaced ? { replaced } : {};
  }

  // --- Business accounts -----------------------------------------------------

  createBusinessAccount(
    actorUserId: string,
    input: { kind: BusinessKind; name: string; country?: string; category?: MerchantCategory; branchIds?: readonly string[] },
  ): BusinessAccount {
    this.#activeUser(actorUserId);
    if (!input.name.trim()) fail("NAME_REQUIRED", "A business name is required");
    if (input.kind !== "PLATFORM" && !(input.country && /^[A-Z]{2}$/.test(input.country))) fail("COUNTRY_REQUIRED", "Merchant and fleet accounts belong to a country");
    if (input.kind === "PLATFORM" && [...this.#accounts.values()].some((a) => a.kind === "PLATFORM" && a.status !== "DELETED")) {
      fail("PLATFORM_EXISTS", "There is exactly one platform organisation");
    }
    const account: BusinessAccount = {
      id: this.#id(),
      kind: input.kind,
      name: input.name.trim(),
      ...pick(input, "country", "category"),
      branchIds: [...(input.branchIds ?? [])],
      images: {},
      status: "ACTIVE",
    };
    this.#accounts.set(account.id, account);
    for (const t of TEMPLATES[input.kind]) {
      // Fleet members only ever act on their own fleet's riders, earnings and payouts.
      const grants = toGrants(t).map((g): Grant => (input.kind === "FLEET" ? { ...g, conditions: [...new Set([...(g.conditions ?? []), "OWN_FLEET" as const])] } : g));
      this.#storeProfile(account, t.name, grants, t.scopes, t.owner ?? false, true);
    }
    const owner = this.profiles(account.id).find((p) => p.owner) as AccessProfile;
    this.#memberships.set(owner.id + ":founder", {
      id: owner.id + ":founder",
      accountId: account.id,
      userId: actorUserId,
      profileIds: [owner.id],
      scopes: [this.#accountWideScope(account)],
      status: "ACTIVE",
      invitedBy: actorUserId,
    });
    this.#log(actorUserId, "account.created", `account:${account.id}`, input.kind);
    return account;
  }

  account(id: string): BusinessAccount {
    return this.#accounts.get(id) ?? fail("ACCOUNT_NOT_FOUND", `No account ${id}`);
  }

  addBranch(actorUserId: string, accountId: string, branchId: string): void {
    const account = this.#requireRight(actorUserId, accountId, "branch:manage");
    if (account.kind !== "MERCHANT") fail("NOT_MERCHANT", "Only merchant accounts have branches");
    if (account.branchIds.includes(branchId)) return;
    this.#accounts.set(account.id, { ...account, branchIds: [...account.branchIds, branchId] });
    this.#log(actorUserId, "account.branch_added", `account:${accountId}`, branchId);
  }

  setAccountImage(actorUserId: string, accountId: string, slot: ImageSlot, image: ImageRef | null): { replaced?: string } {
    const account = this.#requireRight(actorUserId, accountId, "account_profile:edit");
    if (image) validateImage(slot, image);
    const replaced = account.images[slot]?.assetId;
    this.#accounts.set(account.id, { ...account, images: withImage(account.images, slot, image) });
    this.#log(actorUserId, `account.${slot}_picture.${image ? "set" : "removed"}`, `account:${accountId}`);
    return replaced ? { replaced } : {};
  }

  profiles(accountId: string): AccessProfile[] {
    return [...this.#profiles.values()].filter((p) => p.accountId === accountId);
  }

  /** A business defines its own access level from the actions its kind may grant. */
  createAccessProfile(actorUserId: string, accountId: string, input: { name: string; actions: readonly Action[]; scopes?: readonly ScopeType[] }): AccessProfile {
    const account = this.#requireRight(actorUserId, accountId, "access_profile:manage");
    if (!input.name.trim()) fail("NAME_REQUIRED", "A profile name is required");
    if (this.profiles(accountId).some((p) => p.name.toLowerCase() === input.name.trim().toLowerCase())) fail("PROFILE_EXISTS", `${input.name} already exists`);
    if (input.actions.length === 0) fail("ACTIONS_REQUIRED", "Choose at least one permission");
    const notGrantable = input.actions.filter((a) => !GRANTABLE_ACTIONS[account.kind].includes(a));
    if (notGrantable.length) fail("NOT_GRANTABLE", `A ${account.kind.toLowerCase()} account cannot grant: ${notGrantable.join(", ")}`);
    const grants = input.actions.map((action): Grant => (account.kind === "FLEET" ? { action, conditions: ["OWN_FLEET"] } : { action }));
    this.#assertCanGrant(actorUserId, account, grants);
    const allowedScopes = account.kind === "MERCHANT" ? MERCHANT_SCOPES : account.kind === "FLEET" ? (["COUNTRY"] as const) : (["GROUP", "COUNTRY", "CITY"] as const);
    const scopes = input.scopes ?? allowedScopes;
    if (scopes.some((s) => !allowedScopes.includes(s as never))) fail("SCOPE_INVALID", `Scopes must be among ${allowedScopes.join(", ")}`);
    const profile = this.#storeProfile(account, input.name.trim(), grants, scopes, false, false);
    this.#log(actorUserId, "access_profile.created", `account:${accountId}`, `${profile.name}: ${input.actions.join(", ")}`);
    return profile;
  }

  members(accountId: string): Membership[] {
    return [...this.#memberships.values()].filter((m) => m.accountId === accountId && m.status !== "REMOVED");
  }

  /** Adds an account holder with specific access. They must accept before it takes effect. */
  inviteMember(actorUserId: string, accountId: string, input: { userId: string; profileIds: readonly string[]; scopes?: readonly Scope[] }): Membership {
    const account = this.#requireRight(actorUserId, accountId, "account_member:manage");
    this.#activeUser(input.userId);
    if (this.members(accountId).some((m) => m.userId === input.userId)) fail("ALREADY_MEMBER", "This person is already on the account");
    const scopes = input.scopes ?? [this.#accountWideScope(account)];
    this.#assertAssignable(actorUserId, account, input.profileIds, scopes);
    const membership: Membership = { id: this.#id(), accountId, userId: input.userId, profileIds: [...input.profileIds], scopes: [...scopes], status: "INVITED", invitedBy: actorUserId };
    this.#memberships.set(membership.id, membership);
    this.#log(actorUserId, "member.invited", `account:${accountId}`, `${input.userId} as ${this.#profileNames(input.profileIds)}`);
    return membership;
  }

  acceptInvitation(userId: string, membershipId: string): Membership {
    const m = this.#memberships.get(membershipId);
    if (!m || m.userId !== userId) return fail("INVITATION_NOT_FOUND", "No such invitation");
    if (m.status !== "INVITED") fail("INVITATION_USED", `Invitation is ${m.status}`);
    this.#activeUser(userId);
    return this.#putMembership({ ...m, status: "ACTIVE" }, userId, "member.joined");
  }

  changeMemberAccess(actorUserId: string, membershipId: string, input: { profileIds: readonly string[]; scopes?: readonly Scope[] }): Membership {
    const m = this.#membership(membershipId);
    const account = this.#requireRight(actorUserId, m.accountId, "account_member:manage");
    this.#assertCanManage(actorUserId, account, m);
    const scopes = input.scopes ?? m.scopes;
    this.#assertAssignable(actorUserId, account, input.profileIds, scopes);
    const next = { ...m, profileIds: [...input.profileIds], scopes: [...scopes] };
    this.#assertOwnerRemains(account, next);
    return this.#putMembership(next, actorUserId, "member.access_changed", this.#profileNames(input.profileIds));
  }

  suspendMember(actorUserId: string, membershipId: string): Membership {
    return this.#setMemberStatus(actorUserId, membershipId, "SUSPENDED");
  }

  reinstateMember(actorUserId: string, membershipId: string): Membership {
    return this.#setMemberStatus(actorUserId, membershipId, "ACTIVE");
  }

  removeMember(actorUserId: string, membershipId: string): Membership {
    return this.#setMemberStatus(actorUserId, membershipId, "REMOVED");
  }

  /** Compiles a person's active memberships into policy bindings for `authorize`. */
  bindingsFor(userId: string): ProfileRoleBinding[] {
    const user = this.#users.get(userId);
    if (!user || user.status === "DELETED") return [];
    const bindings: ProfileRoleBinding[] = [];
    for (const m of this.#memberships.values()) {
      if (m.userId !== userId || m.status !== "ACTIVE") continue;
      const account = this.#accounts.get(m.accountId);
      if (!account || account.status === "DELETED") continue;
      for (const profileId of m.profileIds) {
        const profile = this.#profiles.get(profileId);
        if (!profile) continue;
        for (const scope of m.scopes) {
          if (!profile.scopes.includes(scope.type)) continue;
          bindings.push({
            id: `${m.id}:${profile.id}:${scopeKey(scope)}`,
            userId,
            scope,
            accountId: account.id,
            ...(account.kind === "FLEET" ? { fleetId: account.id } : {}),
            profile: { id: profile.id, name: profile.name, grants: profile.grants },
          });
        }
      }
    }
    return bindings;
  }

  // --- Deletion (the "delete account" button) --------------------------------

  async requestUserDeletion(userId: string): Promise<DeletionOutcome> {
    const user = this.#activeUser(userId);
    const blockers = await this.#userBlockers(user.id);
    if (blockers.length) return { status: "BLOCKED", blockers };
    const now = this.#now();
    const dueAt = new Date(now.getTime() + this.#graceMs);
    this.#users.set(user.id, { ...user, status: "PENDING_DELETION", deletionRequestedAt: now, deletionDueAt: dueAt });
    this.#log(userId, "user.deletion_requested", `user:${userId}`, `due ${dueAt.toISOString()}`);
    return { status: "SCHEDULED", dueAt };
  }

  cancelUserDeletion(userId: string): UserAccount {
    const user = this.user(userId);
    if (user.status !== "PENDING_DELETION") fail("NOT_PENDING", "No deletion to cancel");
    const restored: UserAccount = { id: user.id, displayName: user.displayName, ...pick(user, "phoneE164", "email"), images: user.images, status: "ACTIVE" };
    this.#users.set(user.id, restored);
    this.#log(userId, "user.deletion_cancelled", `user:${userId}`);
    return restored;
  }

  async requestBusinessDeletion(actorUserId: string, accountId: string): Promise<DeletionOutcome> {
    const account = this.#requireRight(actorUserId, accountId, "account:delete");
    if (account.kind === "PLATFORM") fail("PLATFORM_UNDELETABLE", "The platform organisation cannot be deleted");
    const blockers = await this.#balanceBlockers({ type: "BUSINESS", id: accountId });
    if (blockers.length) return { status: "BLOCKED", blockers };
    const now = this.#now();
    const dueAt = new Date(now.getTime() + this.#graceMs);
    this.#accounts.set(accountId, { ...account, status: "PENDING_DELETION", deletionRequestedAt: now, deletionDueAt: dueAt });
    this.#log(actorUserId, "account.deletion_requested", `account:${accountId}`, `due ${dueAt.toISOString()}`);
    return { status: "SCHEDULED", dueAt };
  }

  cancelBusinessDeletion(actorUserId: string, accountId: string): BusinessAccount {
    const account = this.#requireRight(actorUserId, accountId, "account:delete", true);
    if (account.status !== "PENDING_DELETION") fail("NOT_PENDING", "No deletion to cancel");
    const { deletionRequestedAt: _r, deletionDueAt: _d, ...rest } = account;
    const restored: BusinessAccount = { ...rest, status: "ACTIVE" };
    this.#accounts.set(accountId, restored);
    this.#log(actorUserId, "account.deletion_cancelled", `account:${accountId}`);
    return restored;
  }

  /**
   * Runs scheduled deletions whose grace period has passed (a daily job).
   * Re-checks blockers first: anything opened during the grace period keeps
   * the account pending. Returns image assets to purge from storage.
   */
  async runDueDeletions(): Promise<{ deletedUsers: string[]; deletedAccounts: string[]; stillBlocked: string[]; purgeAssets: string[] }> {
    const now = this.#now();
    const result = { deletedUsers: [] as string[], deletedAccounts: [] as string[], stillBlocked: [] as string[], purgeAssets: [] as string[] };

    for (const account of [...this.#accounts.values()]) {
      if (account.status !== "PENDING_DELETION" || (account.deletionDueAt?.getTime() ?? Infinity) > now.getTime()) continue;
      if ((await this.#balanceBlockers({ type: "BUSINESS", id: account.id })).length) {
        result.stillBlocked.push(`account:${account.id}`);
        continue;
      }
      result.purgeAssets.push(...imageAssets(account.images));
      // The legal name stays for invoices and the ledger; pictures and access go.
      this.#accounts.set(account.id, { ...account, images: {}, status: "DELETED", deletedAt: now });
      for (const m of this.members(account.id)) this.#memberships.set(m.id, { ...m, status: "REMOVED" });
      this.#log("system", "account.deleted", `account:${account.id}`);
      result.deletedAccounts.push(account.id);
    }

    for (const user of [...this.#users.values()]) {
      if (user.status !== "PENDING_DELETION" || (user.deletionDueAt?.getTime() ?? Infinity) > now.getTime()) continue;
      if ((await this.#userBlockers(user.id)).length) {
        result.stillBlocked.push(`user:${user.id}`);
        continue;
      }
      result.purgeAssets.push(...imageAssets(user.images));
      // Pseudonymise: the id survives so ledger and order history stay consistent; personal data does not.
      this.#users.set(user.id, { id: user.id, displayName: "Deleted user", images: {}, status: "DELETED", deletedAt: now });
      for (const m of this.#memberships.values()) if (m.userId === user.id) this.#memberships.set(m.id, { ...m, status: "REMOVED" });
      this.#log("system", "user.deleted", `user:${user.id}`);
      result.deletedUsers.push(user.id);
    }
    return result;
  }

  audit(): readonly AuditRecord[] {
    return [...this.#audit];
  }

  // --- Internals -------------------------------------------------------------

  #activeUser(userId: string): UserAccount {
    const user = this.user(userId);
    if (user.status === "DELETED") fail("USER_DELETED", "This account has been deleted");
    return user;
  }

  #membership(id: string): Membership {
    const m = this.#memberships.get(id);
    if (!m || m.status === "REMOVED") return fail("MEMBER_NOT_FOUND", `No membership ${id}`);
    return m;
  }

  #accountWideScope(account: BusinessAccount): Scope {
    const type = ACCOUNT_WIDE_SCOPE[account.kind];
    if (type === "GROUP") return { type: "GROUP" };
    if (type === "COUNTRY") return { type: "COUNTRY", id: account.country as string };
    return { type: "RESTAURANT_GROUP", id: account.id };
  }

  #isAccountWide(account: BusinessAccount, scope: Scope): boolean {
    return scopeKey(scope) === scopeKey(this.#accountWideScope(account));
  }

  /** The actor's active membership in the account, and the grants it carries. */
  #actorGrants(actorUserId: string, account: BusinessAccount): { membership: Membership; grants: Grant[]; owner: boolean } | undefined {
    const membership = [...this.#memberships.values()].find((m) => m.accountId === account.id && m.userId === actorUserId && m.status === "ACTIVE");
    if (!membership) return undefined;
    const profiles = membership.profileIds.map((id) => this.#profiles.get(id)).filter((p): p is AccessProfile => !!p);
    return { membership, grants: profiles.flatMap((p) => p.grants), owner: profiles.some((p) => p.owner) };
  }

  #requireRight(actorUserId: string, accountId: string, action: Action, allowPending = false): BusinessAccount {
    this.#activeUser(actorUserId);
    const account = this.account(accountId);
    if (account.status === "DELETED") fail("ACCOUNT_DELETED", "This account has been deleted");
    if (account.status === "PENDING_DELETION" && !allowPending) fail("ACCOUNT_PENDING_DELETION", "Cancel the scheduled deletion to make changes");
    const actor = this.#actorGrants(actorUserId, account);
    if (!actor || !actor.grants.some((g) => g.action === "*" || g.action === action)) fail("FORBIDDEN", `You need ${action} on this account`);
    return account;
  }

  /** No privilege escalation: you can only hand out what you hold yourself, at least as restricted. */
  #assertCanGrant(actorUserId: string, account: BusinessAccount, grants: readonly Grant[]): void {
    const actor = this.#actorGrants(actorUserId, account);
    const held = actor?.grants ?? [];
    for (const grant of grants) {
      const covered = held.some(
        (h) => h.action === "*" || (h.action === grant.action && (h.conditions ?? []).every((c) => (grant.conditions ?? []).includes(c))),
      );
      if (!covered) fail("ESCALATION", `You cannot grant ${grant.action}: you do not hold it`);
    }
  }

  #assertAssignable(actorUserId: string, account: BusinessAccount, profileIds: readonly string[], scopes: readonly Scope[]): void {
    if (profileIds.length === 0) fail("PROFILE_REQUIRED", "Choose at least one access level");
    if (scopes.length === 0) fail("SCOPE_REQUIRED", "Choose where this person may act");
    const actor = this.#actorGrants(actorUserId, account);
    if (!actor) return fail("FORBIDDEN", "Not a member of this account");
    for (const id of profileIds) {
      const profile = this.#profiles.get(id);
      if (!profile || profile.accountId !== account.id) fail("PROFILE_NOT_FOUND", `Access level ${id} is not defined on this account`);
      if (profile.owner && !actor.owner) fail("OWNER_ONLY", "Only an owner can make someone an owner");
      this.#assertCanGrant(actorUserId, account, profile.grants);
      const usable = scopes.filter((s) => profile.scopes.includes(s.type));
      if (usable.length === 0) fail("SCOPE_MISMATCH", `${profile.name} cannot be limited to ${scopes.map((s) => s.type).join(", ")}`);
    }
    for (const scope of scopes) {
      this.#assertScopeBelongs(account, scope);
      // A branch-limited manager can only add people to their own branches.
      const actorWide = actor.membership.scopes.some((s) => this.#isAccountWide(account, s));
      if (!actorWide && !actor.membership.scopes.some((s) => scopeKey(s) === scopeKey(scope))) {
        fail("SCOPE_ESCALATION", `You cannot grant access to ${scopeKey(scope)}`);
      }
    }
  }

  #assertScopeBelongs(account: BusinessAccount, scope: Scope): void {
    switch (account.kind) {
      case "MERCHANT":
        if (scope.type === "RESTAURANT_GROUP" && scope.id === account.id) return;
        if (scope.type === "BRANCH" && account.branchIds.includes(scope.id)) return;
        return fail("SCOPE_INVALID", `${scopeKey(scope)} is not part of this business`);
      case "FLEET":
        if (scope.type === "COUNTRY" && scope.id === account.country) return;
        return fail("SCOPE_INVALID", "Fleet members act in the fleet's country");
      case "PLATFORM":
        if (scope.type === "GROUP" || (scope.type === "COUNTRY" && /^[A-Z]{2}$/.test(scope.id)) || (scope.type === "CITY" && scope.id.length > 0)) return;
        return fail("SCOPE_INVALID", `${scopeKey(scope)} is not a platform scope`);
    }
  }

  /** Only owners manage owners; nobody manages a member with wider access than themselves. */
  #assertCanManage(actorUserId: string, account: BusinessAccount, target: Membership): void {
    const actor = this.#actorGrants(actorUserId, account);
    const targetIsOwner = target.profileIds.some((id) => this.#profiles.get(id)?.owner);
    if (targetIsOwner && !actor?.owner) fail("OWNER_ONLY", "Only an owner can change another owner");
    if (!actor?.owner) {
      for (const id of target.profileIds) this.#assertCanGrant(actorUserId, account, this.#profiles.get(id)?.grants ?? []);
    }
  }

  #assertOwnerRemains(account: BusinessAccount, changed: Membership): void {
    const owners = this.members(account.id)
      .map((m) => (m.id === changed.id ? changed : m))
      .filter((m) => m.status === "ACTIVE" && m.profileIds.some((id) => this.#profiles.get(id)?.owner));
    if (owners.length === 0) fail("LAST_OWNER", "An account must keep at least one active owner; add another owner first");
  }

  #setMemberStatus(actorUserId: string, membershipId: string, status: MembershipStatus): Membership {
    const m = this.#membership(membershipId);
    const account = this.#requireRight(actorUserId, m.accountId, "account_member:manage");
    this.#assertCanManage(actorUserId, account, m);
    const next = { ...m, status };
    this.#assertOwnerRemains(account, next);
    return this.#putMembership(next, actorUserId, `member.${status.toLowerCase()}`);
  }

  #putMembership(m: Membership, actorUserId: string, action: string, detail?: string): Membership {
    this.#memberships.set(m.id, m);
    this.#log(actorUserId, action, `account:${m.accountId}`, detail ? `${m.userId}: ${detail}` : m.userId);
    return m;
  }

  #storeProfile(account: BusinessAccount, name: string, grants: readonly Grant[], scopes: readonly ScopeType[], owner: boolean, builtIn: boolean): AccessProfile {
    const profile: AccessProfile = { id: this.#id(), accountId: account.id, name, grants, scopes, owner, builtIn };
    this.#profiles.set(profile.id, profile);
    return profile;
  }

  #profileNames(ids: readonly string[]): string {
    return ids.map((id) => this.#profiles.get(id)?.name ?? id).join(", ");
  }

  async #userBlockers(userId: string): Promise<DeletionBlocker[]> {
    const blockers = await this.#balanceBlockers({ type: "USER", id: userId });
    for (const m of this.#memberships.values()) {
      if (m.userId !== userId || m.status !== "ACTIVE") continue;
      const account = this.#accounts.get(m.accountId);
      if (!account || account.status === "DELETED") continue;
      const isOwner = m.profileIds.some((id) => this.#profiles.get(id)?.owner);
      const otherOwners = this.members(account.id).filter(
        (o) => o.userId !== userId && o.status === "ACTIVE" && o.profileIds.some((id) => this.#profiles.get(id)?.owner),
      );
      if (isOwner && otherOwners.length === 0) blockers.push({ code: "SOLE_OWNER", accountId: account.id, accountName: account.name });
    }
    return blockers;
  }

  async #balanceBlockers(subject: DeletionSubject): Promise<DeletionBlocker[]> {
    const blockers: DeletionBlocker[] = [];
    const open = await this.#checks.openOrders(subject);
    if (open > 0) blockers.push({ code: "OPEN_ORDERS", count: open });
    for (const amount of await this.#checks.outstandingBalances(subject)) {
      if (amount.minor !== "0") blockers.push({ code: "BALANCE_OUTSTANDING", amount });
    }
    return blockers;
  }

  #log(actorUserId: string, action: string, target: string, detail?: string): void {
    this.#audit.push({ at: this.#now(), actorUserId, action, target, ...(detail ? { detail } : {}) });
  }
}

function toGrants(t: Template): Grant[] {
  if (t.actions === "*") return [{ action: "*" }];
  return t.actions.map((action) => {
    const conditions = t.conditions?.[action];
    return conditions ? { action, conditions } : { action };
  });
}

function withImage(images: AccountImages, slot: ImageSlot, image: ImageRef | null): AccountImages {
  const { [slot]: _old, ...rest } = images;
  return image ? { ...rest, [slot]: image } : rest;
}

function imageAssets(images: AccountImages): string[] {
  return [images.profile?.assetId, images.cover?.assetId].filter((a): a is string => !!a);
}

function pick<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
