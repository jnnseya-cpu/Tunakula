import { test } from "node:test";
import assert from "node:assert/strict";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { MoneyJSON } from "@tunakula/ts-money";
import {
  AccountDirectory,
  AccountError,
  TEMPLATES,
  authorize,
  type DeletionChecks,
  type DeletionSubject,
  type ImageRef,
  type ResourceContext,
} from "../src/index.ts";
import { syntheticProfile } from "./helpers.ts";

const cd: CountryProfile = { ...syntheticProfile("cd"), country: { ...syntheticProfile("cd").country, status: "LIVE" } };
const inCD = { activeCountry: "CD", profile: cd } as const;

/** Deletion checks the tests can steer: open orders and balances per subject. */
function stubChecks() {
  const open = new Map<string, number>();
  const balances = new Map<string, MoneyJSON[]>();
  const key = (s: DeletionSubject) => `${s.type}:${s.id}`;
  const checks: DeletionChecks = {
    openOrders: async (s) => open.get(key(s)) ?? 0,
    outstandingBalances: async (s) => balances.get(key(s)) ?? [],
  };
  return { checks, open, balances, key };
}

function setup() {
  let now = new Date("2026-10-04T12:00:00Z");
  let n = 0;
  const stub = stubChecks();
  const dir = new AccountDirectory({ checks: stub.checks, deletionGraceDays: 30, now: () => now, newId: () => `id${++n}` });
  const user = (name: string) => dir.registerUser({ displayName: name, phoneE164: `+24381${String(++n).padStart(7, "0")}` });
  return { dir, user, stub, advance: (days: number) => (now = new Date(now.getTime() + days * 86_400_000)) };
}

/** A restaurant group with two branches and an owner. */
function restaurant() {
  const s = setup();
  const owner = s.user("Mama Pauline");
  const acct = s.dir.createBusinessAccount(owner.id, { kind: "MERCHANT", name: "Chez Pauline", country: "CD", category: "RESTAURANT", branchIds: ["br-gombe", "br-limete"] });
  const profile = (name: string) => s.dir.profiles(acct.id).find((p) => p.name === name)?.id as string;
  const join = (inviter: string, userId: string, names: string[], scopes?: Parameters<typeof s.dir.inviteMember>[2]["scopes"]) => {
    const m = s.dir.inviteMember(inviter, acct.id, { userId, profileIds: names.map(profile), ...(scopes ? { scopes } : {}) });
    return s.dir.acceptInvitation(userId, m.id);
  };
  return { ...s, owner, acct, profile, join };
}

const order = (branchId: string): ResourceContext => ({ type: "order", country: "CD", restaurantGroupId: "acct", branchId });
const can = (dir: AccountDirectory, userId: string, action: Parameters<typeof authorize>[1], resource: ResourceContext, req: Parameters<typeof authorize>[3] = inCD) =>
  authorize({ userId, bindings: dir.bindingsFor(userId) }, action, resource, req).allowed;
const rejects = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof AccountError && e.code === code, `expected ${code}`);
const rejectsAsync = async (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AccountError && e.code === code);

test("a business starts with its founder as owner and ready-made access levels", () => {
  const { dir, owner, acct } = restaurant();
  assert.deepEqual(dir.profiles(acct.id).map((p) => p.name), TEMPLATES.MERCHANT.map((t) => t.name));
  const [founder] = dir.members(acct.id);
  assert.equal(founder?.userId, owner.id);
  assert.equal(founder?.status, "ACTIVE");
  const r = { ...order("br-gombe"), restaurantGroupId: acct.id };
  assert.ok(can(dir, owner.id, "menu:write", r));
  assert.ok(can(dir, owner.id, "pos:void", r));
});

test("several account holders, each with their own access level and branch limits", () => {
  const { dir, user, acct, owner, join } = restaurant();
  const manager = user("Jean (manager, Gombe)");
  const cook = user("Aimée (kitchen, Gombe)");
  const accountant = user("Patrick (accountant)");
  join(owner.id, manager.id, ["Manager"], [{ type: "BRANCH", id: "br-gombe" }]);
  join(owner.id, cook.id, ["Kitchen"], [{ type: "BRANCH", id: "br-gombe" }]);
  join(owner.id, accountant.id, ["Accountant"]);
  assert.equal(dir.members(acct.id).length, 4);

  const gombe = { ...order("br-gombe"), restaurantGroupId: acct.id };
  const limete = { ...order("br-limete"), restaurantGroupId: acct.id };
  // Kitchen: prepare orders at their branch only, nothing else.
  assert.ok(can(dir, cook.id, "order:prepare", gombe));
  assert.ok(!can(dir, cook.id, "order:prepare", limete));
  assert.ok(!can(dir, cook.id, "pos:void", gombe));
  // Manager: runs their branch, cannot touch the other one or the menu.
  assert.ok(can(dir, manager.id, "pos:void", gombe));
  assert.ok(!can(dir, manager.id, "pos:void", limete));
  assert.ok(!can(dir, manager.id, "menu:write", gombe));
  // Accountant: payouts across the group, no operations.
  assert.ok(can(dir, accountant.id, "payout:read", limete));
  assert.ok(!can(dir, accountant.id, "order:accept", limete));
});

test("an invitation has no effect until accepted; suspension removes access at once", () => {
  const { dir, user, acct, owner, profile } = restaurant();
  const cashier = user("Cashier");
  const m = dir.inviteMember(owner.id, acct.id, { userId: cashier.id, profileIds: [profile("Cashier")] });
  const r = { ...order("br-gombe"), restaurantGroupId: acct.id };
  assert.ok(!can(dir, cashier.id, "pos:operate", r));
  dir.acceptInvitation(cashier.id, m.id);
  assert.ok(can(dir, cashier.id, "pos:operate", r));
  dir.suspendMember(owner.id, m.id);
  assert.ok(!can(dir, cashier.id, "pos:operate", r));
  dir.reinstateMember(owner.id, m.id);
  assert.ok(can(dir, cashier.id, "pos:operate", r));
  rejects(() => dir.acceptInvitation(cashier.id, m.id), "INVITATION_USED");
});

test("businesses can define custom access levels, only from what their kind may grant", () => {
  const { dir, user, acct, owner } = restaurant();
  const night = dir.createAccessProfile(owner.id, acct.id, { name: "Night supervisor", actions: ["order:read", "pos:void", "cash_drawer:manage"] });
  const sup = user("Night supervisor");
  const m = dir.inviteMember(owner.id, acct.id, { userId: sup.id, profileIds: [night.id], scopes: [{ type: "BRANCH", id: "br-limete" }] });
  dir.acceptInvitation(sup.id, m.id);
  const limete = { ...order("br-limete"), restaurantGroupId: acct.id };
  assert.ok(can(dir, sup.id, "cash_drawer:manage", limete));
  assert.ok(!can(dir, sup.id, "pos:refund", limete));

  rejects(() => dir.createAccessProfile(owner.id, acct.id, { name: "Bad", actions: ["refund:issue"] }), "NOT_GRANTABLE");
  rejects(() => dir.createAccessProfile(owner.id, acct.id, { name: "Bad2", actions: ["order:place"] }), "NOT_GRANTABLE");
  rejects(() => dir.createAccessProfile(owner.id, acct.id, { name: "night supervisor", actions: ["order:read"] }), "PROFILE_EXISTS");
  rejects(() => dir.createAccessProfile(owner.id, acct.id, { name: "Empty", actions: [] }), "ACTIONS_REQUIRED");
});

test("no privilege escalation: you can only hand out what you hold, where you hold it", () => {
  const { dir, user, acct, owner, profile, join } = restaurant();
  const manager = user("Manager");
  const mm = join(owner.id, manager.id, ["Manager"], [{ type: "BRANCH", id: "br-gombe" }]);
  const newcomer = user("Newcomer");

  // Managers may add staff — but only to their own branch, never as owner, never with rights they lack.
  rejects(() => dir.inviteMember(manager.id, acct.id, { userId: newcomer.id, profileIds: [profile("Kitchen")], scopes: [{ type: "BRANCH", id: "br-limete" }] }), "SCOPE_ESCALATION");
  rejects(() => dir.inviteMember(manager.id, acct.id, { userId: newcomer.id, profileIds: [profile("Owner")], scopes: [{ type: "BRANCH", id: "br-gombe" }] }), "OWNER_ONLY");
  rejects(() => dir.inviteMember(manager.id, acct.id, { userId: newcomer.id, profileIds: [profile("Marketing")], scopes: [{ type: "BRANCH", id: "br-gombe" }] }), "ESCALATION");
  rejects(() => dir.createAccessProfile(manager.id, acct.id, { name: "x", actions: ["menu:write"] }), "FORBIDDEN");
  const ok = dir.inviteMember(manager.id, acct.id, { userId: newcomer.id, profileIds: [profile("Kitchen")], scopes: [{ type: "BRANCH", id: "br-gombe" }] });
  assert.equal(ok.status, "INVITED");

  // Managers cannot change the owner or unknown branches.
  const ownerMembership = dir.members(acct.id).find((m) => m.userId === owner.id)!;
  rejects(() => dir.suspendMember(manager.id, ownerMembership.id), "OWNER_ONLY");
  rejects(() => dir.inviteMember(owner.id, acct.id, { userId: user("x").id, profileIds: [profile("Kitchen")], scopes: [{ type: "BRANCH", id: "br-elsewhere" }] }), "SCOPE_INVALID");

  // Kitchen staff cannot manage members at all.
  const cook = user("Cook");
  join(owner.id, cook.id, ["Kitchen"]);
  rejects(() => dir.inviteMember(cook.id, acct.id, { userId: user("y").id, profileIds: [profile("Kitchen")] }), "FORBIDDEN");
  assert.equal(mm.status, "ACTIVE");
});

test("an account always keeps at least one owner; owners can share ownership", () => {
  const { dir, user, acct, owner, join } = restaurant();
  const ownerMembership = dir.members(acct.id).find((m) => m.userId === owner.id)!;
  rejects(() => dir.removeMember(owner.id, ownerMembership.id), "LAST_OWNER");
  const partner = user("Business partner");
  join(owner.id, partner.id, ["Owner"]);
  dir.removeMember(owner.id, ownerMembership.id);
  assert.deepEqual(dir.members(acct.id).map((m) => m.userId), [partner.id]);
  assert.equal(dir.bindingsFor(owner.id).length, 0);
});

test("the platform admin organisation works the same way, with country-limited admins", () => {
  const s = setup();
  const ceo = s.user("Group CEO");
  const platform = s.dir.createBusinessAccount(ceo.id, { kind: "PLATFORM", name: "Groupe Nseya — Tunakula" });
  rejects(() => s.dir.createBusinessAccount(ceo.id, { kind: "PLATFORM", name: "Another" }), "PLATFORM_EXISTS");
  const p = (name: string) => s.dir.profiles(platform.id).find((x) => x.name === name)!.id;
  const admin = s.user("DRC country admin");
  const agent = s.user("Kinshasa support agent");
  for (const [u, prof] of [[admin, "Country Admin"], [agent, "Support Agent"]] as const) {
    const m = s.dir.inviteMember(ceo.id, platform.id, { userId: u.id, profileIds: [p(prof)], scopes: [{ type: "COUNTRY", id: "CD" }] });
    s.dir.acceptInvitation(u.id, m.id);
  }
  const r: ResourceContext = { type: "order", country: "CD" };
  assert.ok(can(s.dir, admin.id, "country_config:write", r));
  assert.ok(!can(s.dir, admin.id, "country_config:write", { type: "order", country: "GB" }, { activeCountry: "GB", profile: { ...cd, country: { ...cd.country, iso2: "GB" } } }));
  // Built-in conditions survive: support refunds stay capped by the Country Profile.
  assert.ok(can(s.dir, agent.id, "refund:issue", r, { ...inCD, amount: { currency: "USD", minor: "2500" } }));
  assert.ok(!can(s.dir, agent.id, "refund:issue", r, { ...inCD, amount: { currency: "USD", minor: "9900" } }));
  // A Country Admin cannot create a Super Admin.
  rejects(() => s.dir.inviteMember(admin.id, platform.id, { userId: s.user("z").id, profileIds: [p("Super Admin")] }), "FORBIDDEN");
});

test("fleet accounts: members only ever see their own fleet's riders", () => {
  const s = setup();
  const boss = s.user("Moto Express owner");
  const fleet = s.dir.createBusinessAccount(boss.id, { kind: "FLEET", name: "Moto Express", country: "CD" });
  const dispatcher = s.user("Dispatcher");
  const dp = s.dir.profiles(fleet.id).find((x) => x.name === "Dispatcher")!.id;
  s.dir.acceptInvitation(dispatcher.id, s.dir.inviteMember(boss.id, fleet.id, { userId: dispatcher.id, profileIds: [dp] }).id);
  assert.ok(can(s.dir, dispatcher.id, "fleet_rider:manage", { type: "rider", country: "CD", fleetId: fleet.id }));
  assert.ok(!can(s.dir, dispatcher.id, "fleet_rider:manage", { type: "rider", country: "CD", fleetId: "other-fleet" }));
  assert.ok(!can(s.dir, dispatcher.id, "payout:read", { type: "payout", country: "CD", fleetId: fleet.id }));
});

const img = (assetId: string, w: number, h: number, extra: Partial<ImageRef> = {}): ImageRef => ({ assetId, contentType: "image/jpeg", bytes: 300_000, width: w, height: h, ...extra });

test("every account has a profile picture and a cover picture", () => {
  const { dir, user, acct, owner, join } = restaurant();
  // Personal account.
  assert.deepEqual(dir.setUserImage(owner.id, "profile", img("u-1", 400, 400)), {});
  assert.deepEqual(dir.setUserImage(owner.id, "profile", img("u-2", 400, 400)), { replaced: "u-1" });
  dir.setUserImage(owner.id, "cover", img("u-c", 1500, 500));
  assert.equal(dir.user(owner.id).images.profile?.assetId, "u-2");
  assert.deepEqual(dir.setUserImage(owner.id, "cover", null), { replaced: "u-c" });
  assert.equal(dir.user(owner.id).images.cover, undefined);

  // Business account: owner and marketing may edit; kitchen may not.
  dir.setAccountImage(owner.id, acct.id, "profile", img("logo", 512, 512, { contentType: "image/png" }));
  const marketing = user("Marketing");
  join(owner.id, marketing.id, ["Marketing"]);
  dir.setAccountImage(marketing.id, acct.id, "cover", img("cover", 1600, 600, { contentType: "image/webp" }));
  const cook = user("Cook");
  join(owner.id, cook.id, ["Kitchen"]);
  rejects(() => dir.setAccountImage(cook.id, acct.id, "cover", img("x", 1600, 600)), "FORBIDDEN");
  assert.deepEqual(Object.keys(dir.account(acct.id).images).sort(), ["cover", "profile"]);

  // Validation.
  rejects(() => dir.setUserImage(owner.id, "profile", img("g", 400, 400, { contentType: "image/gif" })), "IMAGE_TYPE");
  rejects(() => dir.setUserImage(owner.id, "profile", img("big", 400, 400, { bytes: 6 * 1024 * 1024 })), "IMAGE_TOO_LARGE");
  rejects(() => dir.setUserImage(owner.id, "profile", img("tiny", 100, 100)), "IMAGE_TOO_SMALL");
  rejects(() => dir.setUserImage(owner.id, "cover", img("square", 1500, 1500)), "IMAGE_ASPECT");
});

test("delete account: blocked until orders, money and ownership are settled", async () => {
  const { dir, user, acct, owner, stub, join } = restaurant();
  const customer = user("Customer");
  stub.open.set(`USER:${customer.id}`, 1);
  stub.balances.set(`USER:${customer.id}`, [{ currency: "USD", minor: "1250" }, { currency: "CDF", minor: "0" }]);
  const blocked = await dir.requestUserDeletion(customer.id);
  assert.equal(blocked.status, "BLOCKED");
  assert.deepEqual(blocked.status === "BLOCKED" && blocked.blockers.map((b) => b.code), ["OPEN_ORDERS", "BALANCE_OUTSTANDING"]);

  // The sole owner of a business must hand over ownership first.
  const soleOwner = await dir.requestUserDeletion(owner.id);
  assert.ok(soleOwner.status === "BLOCKED" && soleOwner.blockers.some((b) => b.code === "SOLE_OWNER" && b.accountName === "Chez Pauline"));
  join(owner.id, user("New owner").id, ["Owner"]);
  assert.equal((await dir.requestUserDeletion(owner.id)).status, "SCHEDULED");
  assert.equal(dir.account(acct.id).status, "ACTIVE", "deleting a person never deletes the business");
});

test("delete account: grace period, cancel, then pseudonymise and purge pictures", async () => {
  const { dir, user, advance, stub } = setup();
  const u = user("Grace");
  dir.setUserImage(u.id, "profile", img("face", 400, 400));
  dir.setUserImage(u.id, "cover", img("banner", 1500, 500));
  const scheduled = await dir.requestUserDeletion(u.id);
  assert.equal(scheduled.status, "SCHEDULED");
  assert.equal(dir.user(u.id).status, "PENDING_DELETION");
  assert.equal(dir.cancelUserDeletion(u.id).status, "ACTIVE");

  await dir.requestUserDeletion(u.id);
  advance(29);
  assert.deepEqual((await dir.runDueDeletions()).deletedUsers, [], "nothing happens inside the grace period");
  // An order placed during the grace period keeps the account pending.
  stub.open.set(`USER:${u.id}`, 1);
  advance(2);
  assert.deepEqual((await dir.runDueDeletions()).stillBlocked, [`user:${u.id}`]);
  stub.open.delete(`USER:${u.id}`);

  const result = await dir.runDueDeletions();
  assert.deepEqual(result.deletedUsers, [u.id]);
  assert.deepEqual(result.purgeAssets.sort(), ["banner", "face"]);
  const gone = dir.user(u.id);
  assert.equal(gone.status, "DELETED");
  assert.equal(gone.displayName, "Deleted user");
  assert.equal(gone.phoneE164, undefined);
  assert.deepEqual(gone.images, {});
  rejects(() => dir.setUserImage(u.id, "profile", img("again", 400, 400)), "USER_DELETED");
});

test("delete a business: owners only, never the platform, frozen while pending, history kept", async () => {
  const { dir, user, acct, owner, join, advance, stub } = restaurant();
  const manager = user("Manager");
  join(owner.id, manager.id, ["Manager"]);
  await rejectsAsync(dir.requestBusinessDeletion(manager.id, acct.id), "FORBIDDEN");

  stub.balances.set(`BUSINESS:${acct.id}`, [{ currency: "USD", minor: "48000" }]);
  const blocked = await dir.requestBusinessDeletion(owner.id, acct.id);
  assert.ok(blocked.status === "BLOCKED" && blocked.blockers[0]?.code === "BALANCE_OUTSTANDING", "unpaid payouts must be settled first");
  stub.balances.delete(`BUSINESS:${acct.id}`);

  dir.setAccountImage(owner.id, acct.id, "profile", img("logo", 512, 512));
  assert.equal((await dir.requestBusinessDeletion(owner.id, acct.id)).status, "SCHEDULED");
  rejects(() => dir.addBranch(owner.id, acct.id, "br-new"), "ACCOUNT_PENDING_DELETION");
  assert.equal(dir.cancelBusinessDeletion(owner.id, acct.id).status, "ACTIVE");
  await dir.requestBusinessDeletion(owner.id, acct.id);

  advance(31);
  const result = await dir.runDueDeletions();
  assert.deepEqual(result.deletedAccounts, [acct.id]);
  assert.deepEqual(result.purgeAssets, ["logo"]);
  assert.equal(dir.account(acct.id).name, "Chez Pauline", "legal name kept for invoices and the ledger");
  assert.equal(dir.members(acct.id).length, 0);
  assert.equal(dir.bindingsFor(manager.id).length, 0);
  assert.equal(dir.user(owner.id).status, "ACTIVE", "people keep their personal accounts");

  const s = setup();
  const ceo = s.user("CEO");
  const platform = s.dir.createBusinessAccount(ceo.id, { kind: "PLATFORM", name: "Platform" });
  await rejectsAsync(s.dir.requestBusinessDeletion(ceo.id, platform.id), "PLATFORM_UNDELETABLE");
});

test("every access change is audited", () => {
  const { dir, user, acct, owner, join } = restaurant();
  join(owner.id, user("Cook").id, ["Kitchen"]);
  const actions = dir.audit().map((a) => a.action);
  assert.deepEqual(actions, ["account.created", "member.invited", "member.joined"]);
  assert.ok(dir.audit().every((a) => a.at instanceof Date && a.target === `account:${acct.id}`));
});
