# ADR 0005 — Business accounts with multiple holders, per-member access, pictures and deletion

- Status: Accepted
- Date: 2026-10-04

## Context
Product direction (2026-10-04): an admin account can have multiple account holders, each with a different,
specific access level, and the same for restaurants and every other business. Every account has a profile
picture, a cover picture and a delete button. PRD §8.2 defines scoped roles; §12.4 (OMN-005) asks for
staff-level authorisation for discount, void and refund; §19.1 MR-7, §12.4 and §27 forbid erasing
financial records and require retention per market.

## Decision
- **Business account** (`PLATFORM`, `MERCHANT`, `FLEET`; merchants carry a category — restaurant,
  supermarket, pharmacy, shop, other). There is exactly one platform organisation.
- **Members** (account holders) hold one or more **access profiles** and may be limited to specific
  branches (merchant), countries or cities (platform). Invitations take effect only when accepted;
  members can be suspended, reinstated or removed.
- **Access profiles**: each account kind gets starter templates (platform templates mirror the §8.2
  roles, including their conditions such as the support refund cap) and may define custom ones from the
  actions its kind is allowed to grant. Personal actions (ordering, wallet, rider jobs) are never grantable.
- **No privilege escalation**: a member can only grant actions they hold (at least as restricted), only
  within their own branches/countries, and only owners can create or change owners. Every account keeps
  at least one active owner.
- Memberships compile into scoped role bindings, so `authorize` remains the single policy path.
  Fleet grants always carry `OWN_FLEET`.
- **Pictures**: profile (≥200×200, near-square, ≤5 MB) and cover (≥1200×400, 2:1–4:1, ≤10 MB), JPEG,
  PNG or WebP. Storage holds the bytes; the account holds a reference. Replacing or removing a picture
  returns the old asset for purging.
- **Delete account** (personal or business): blocked while orders are open, money is owed either way, or
  the person is the sole owner of a business — the blockers are returned so the app can say what to fix.
  Otherwise deletion is scheduled with a grace period (default 30 days) during which it can be cancelled
  and the business is frozen. When due, blockers are re-checked; then pictures are purged, access is
  revoked and personal data is pseudonymised. The id, the business's legal name, orders and the ledger
  remain, as the law and MR-7 require. The platform organisation cannot be deleted.
- Every access change is written to an audit log.

## Consequences
- The grace period should eventually come from the market's Compliance Pack retention schedule.
- Open-order and balance checks are a port (`DeletionChecks`) implemented by Ordering and Money.
- Apps render the delete button, the blocker list and the "cancel deletion" banner from these outcomes.
