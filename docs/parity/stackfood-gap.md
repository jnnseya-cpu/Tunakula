# Gap against the legacy StackFood platform (honest inventory, 2026-10-04)

The legacy Tunakula runs on StackFood v8. It has four products: a customer app and website, a restaurant panel and app, a deliveryman app, and an admin panel with roughly 150 screens.
The new platform matches or beats it on the core engine: orders, custody, payments, ledger, roles, per-country rules, audit, distance and delivery time.
Most of what people see and touch is still missing. The rows below say plainly what exists.

Legend: **Built** works end to end · **Partial** the engine or a screen exists, not the full feature · **Missing** nothing usable yet.

## Customer (app and website)

| Feature | Status |
| --- | --- |
| Home: banners, categories, nearby restaurants, popular dishes | Built (preview): the real Kinshasa restaurants with their names, menus, logos, covers and dish photos; the home grid and every storefront read the live catalogue API in the browser and fall back to a committed snapshot offline |
| Distance (km) and delivery time per restaurant | Built (API and website) |
| Sign up / sign in by phone code | Built (SMS or WhatsApp code; delivery needs the messaging adapter) |
| Search with filters (veg, rating, price, cuisine, distance) | Partial: text search and sort; **dietary/allergen filtering built** — a live storefront chip filter (vegetarian, vegan, halal, gluten-free, dairy-free, nut-free) over structured per-dish dietary tags |
| Structured dietary tags, allergens (EU 14) and nutrition per dish | Built: merchants set validated dietary tags + per-serving nutrition (kcal, protein, carbs, fat) in the menu editor; the API validates and serves them; the storefront shows dietary badges, calories and allergens, and filters by diet (the Uber Eats / Deliveroo / Just Eat compliance feature) |
| Age-restricted items (alcohol) and 18+ verification | Built: merchants flag a dish `age_restricted` in the menu editor; the storefront shows an 18+ badge; the quote marks the order age-restricted and checkout requires an 18+ confirmation (the API refuses to place with `AGE_CONFIRMATION_REQUIRED` until confirmed); the order snapshot carries `ageRestricted`; the rider job shows a "check a photo ID at the door" prompt (the Deliveroo age-verification pattern StackFood lacks) |
| Restaurant page with menu | Built: live menu, availability, allergens, distance, time, fee |
| Food details: variations, add-ons, notes | Built on the live storefront: an option picker (required/optional variations, single or multiple choice, add-ons) with a live price; the chosen options and their prices flow through the cart and checkout into the order. **Notes built**: a free-text kitchen note at checkout ("no cutlery, extra spicy") and an optional per-dish note, both carried on the order snapshot and shown on the kitchen board (never carrying allergen or payment data) |
| Cart and checkout: delivery, takeaway, dine-in, scheduled | Built for delivery and takeaway (live quote, directions, tip). **Dine-in table bookings built**: a customer books a table for a party of one or more at a chosen time (with an optional note); the restaurant confirms, seats, completes, declines or marks a no-show from the merchant panel; the customer tracks and cancels bookings on /bookings. **Scheduled orders built**: at checkout the customer can schedule a delivery or takeaway for a future day and time (30 minutes to 7 days ahead); the order is placed but held, and the dispatcher releases it to the kitchen and to riders 30 minutes before the slot — never offered to a rider early, never auto-cancelled for a "no kitchen response" before it is due; the kitchen board and the customer's order list show the scheduled time |
| Group ordering + bill-split | Built: a server-side shared cart with an invite code/link, each person adds their own dishes from their phone, the host locks and places one order (COD or mobile money), and the bill splits per person (each one's food plus a proportional slice of service charge, delivery and tip) summing to the total to the cent — the Uber Eats / DoorDash social-order feature StackFood lacks |
| Pay: mobile money, card, cash, wallet, partial payment | Built: mobile money, card, cash on delivery. **Wallet built**: an in-app customer wallet (balance + history on /wallet) topped up through the same providers; a customer pays for an order straight from the balance at checkout (the order is placed already paid); a cancelled wallet order is credited back automatically, and a delivered wallet order's settlement draws from the customer_wallet ledger account so the books stay balanced. Partial payment (wallet + another method on one order) still missing |
| Coupons, cashback, campaigns | Built (coupons): promo codes at checkout — percentage, fixed amount or free delivery, with minimum subtotal, max-discount cap, total and per-customer limits and a validity window; the platform funds the discount at settlement (promotion_expense) so the merchant and rider are paid in full, and the books stay balanced. Cashback and campaigns still missing |
| Paid membership (Tunakula Plus): free delivery and/or service-charge discount | Built: admin defines plans per market; customers subscribe (`/membership`), the benefit shows live on the quote and checkout, the platform funds it from subscription revenue so the merchant and rider are still paid in full, and the settlement journal stays balanced. This is the DashPass / Uber One / Deliveroo Plus equivalent |
| Live order tracking with map and rider | Built: live progress, door code, rider name, distance, arrival time and a map (kitchen, rider, door); street tiles need a map provider key |
| Order history, reorder, cancel with reason, refund request | Built: history, order again, cancel. **Refund request built**: after delivery the customer requests a refund with a reason (within 7 days) from the tracking page; support reviews a queue and approves — the money is refunded through the same provider and the settlement is reversed so the books stay balanced — or declines, returning the order to delivered |
| Reviews and ratings | Built: after a delivered order the customer rates the restaurant (1–5 stars) and optionally the rider, with a comment; the rating shows on the storefront (average + count) and feeds the performance scorecard; the restaurant replies from the merchant panel |
| Chat with restaurant and rider; push and SMS notifications | Missing |
| Wallet, loyalty points, referral | Partial: **in-app wallet built** (balance, top-up, history, pay-with-wallet at checkout, auto-credit on cancellation). **Referral built**: every customer has a shareable code; the friend who applies it (the referee) has our service fee (our 10%) waived on their first order — the merchant and rider are still paid in full, the platform gives up only its own fee — and the referrer earns a reward (10 of the settlement currency) to their wallet once that referee has spent the threshold (50) on the platform, credited as real, spendable money funded from promotion_expense. Loyalty points still missing |
| Saved addresses with map pin | Built: a customer keeps several named map pins (Home, Work…), sets a default, and picks one at checkout as quick-pick chips; a one-tap "Save this address" stores the current pin |
| Favourites | Built: a heart on each storefront adds/removes the restaurant from the customer's favourites (GET /v1/me/favourites, with name, commune and rating) |
| Subscription (repeat) orders | Missing |
| Languages FR / EN / LN / SW, dark mode | Missing (English only) |
| Native Android / iOS apps | Missing |

## Restaurant (panel and app)

| Feature | Status |
| --- | --- |
| Dashboard and reports | Partial: admin dashboard scoped to the owner's branches |
| Live orders: accept, prepare, ready, hand over | Built: live kitchen board with sound, accept/reject with reason, cook, pack (line check, allergens, bags), ready (labels, seals, photo), counter handover with code |
| POS | Missing |
| Menu: foods, categories, variations, add-ons, availability, bulk import | Built (merchant): menu management (list, search, add, edit, availability, recommended; name/description per language, category, price, veg, tags, allergens), **variations and add-ons** (defined per dish and priced into the quote, order line and total), and **CSV bulk import/export** (all-or-nothing, upsert by id) in the console at Commerce → Carte et plats. Categories are free text, not yet a managed list; bulk import covers foods, not options |
| Opening hours, schedule, temporary close | Built: a weekly schedule (per-day open/close windows, multi-window supported) plus date overrides for holidays/special hours, set per restaurant; customers can only order during open hours and the storefront shows open/closed from the schedule, on top of the existing audited pause/resume |
| Coupons, campaigns, ads | Missing |
| Reviews and replies | Built: the owner sees every review for a branch and replies (Merchants → a restaurant → Customer reviews) |
| Wallet, withdrawals, earnings | Partial: ledger only |
| Employees and roles | Partial: team page (admin) |
| Self-registration and onboarding | Built: a **self-serve onboarding wizard** (admin console → Get started) with no field team needed — a business owner registers (becomes the owner of their own restaurant group), adds a branch with its location (use-my-location or coordinates), builds a menu, then publishes. A branch is only discoverable once published; the storefront (and Tunakula Nzela, the WhatsApp channel, which reads the same catalogue) picks it up immediately on publish |

## Deliveryman (app)

| Feature | Status |
| --- | --- |
| Go online / offline, shifts | Built: online/offline with GPS (position shared only while online or carrying an order); shifts missing |
| Safety / SOS | Built: an in-app SOS button (I need help / unsafe / accident / vehicle) that sends the rider's location to an operations safety queue on the dispatch board, where ops acknowledge and resolve it with a map link — the DoorDash SafeDash / Uber Safety Toolkit equivalent |
| Job offers, accept, navigation, pick up, deliver with code and photo | Built: automatic nearest-rider offers (30 s, earnings shown first, no penalty for saying no), navigation links, bag check at pickup, code + GPS + photo at the door, failed-delivery report |
| Earnings, wallet, cash in hand, remittance | Built: today's earnings, a **per-delivery breakdown** (base + tip per order), cash in hand, cash hand-in at the hub, and **instant cash-out** — the rider withdraws their earned balance to mobile money on demand (ledger: rider_payable → psp_clearing, balanced and idempotent), the DoorDash Fast Pay / Uber Instant Pay feature |
| Vehicles, documents, self-registration | Built: apply with ID, selfie and licence photos, automatic checks (age, ID format, duplicate ID, licence and plate), review and approval by operations |

## Admin

| Area | Status |
| --- | --- |
| Dashboard with charts per role | Built |
| Orders list, detail, cancel | Built |
| Dispatch management (assign or reassign riders, live map) | Built: automatic dispatch, kitchen timeouts, live dispatch screen with map, rider statuses, assign/reassign, refunds needing attention |
| Refunds | Built: automatic full refunds for paid orders that end before delivery, with retries; **plus customer-initiated refund requests after delivery** — the customer files a request with a reason, support approves (money refunded through the same provider, settlement reversed so the books balance) or declines, all from a support refund queue |
| Zones (polygons, fees per zone) | Missing |
| Cuisines, categories, add-ons, foods, bulk import/export | Partial: per-restaurant menu only |
| Restaurants: list, add, join requests, commission/plan | Partial: list and menu |
| Promotions: campaigns, banners, coupons, cashback, push, ads | Partial: **coupon manager built** (Commerce → Codes promo: percentage/fixed/free-delivery codes with min subtotal, caps, limits and a window); campaigns, banners, cashback, push and ads still missing |
| Membership plans (Tunakula Plus): define, price, benefits, activate | Built: plan manager at Commerce → Abonnement Plus (free delivery over a minimum subtotal, service-charge discount %, monthly/yearly), gated by `membership:manage` |
| Customers: list, wallet, loyalty, subscribers | Missing |
| Deliverymen: list, vehicles, shifts, reviews, bonuses, join requests | Partial: rider list with status and cash, join requests with ID review, and **incentive quests** (admin defines "N deliveries in a window for a bonus" at Riders; riders see progress and claim the bonus into their cashable balance) plus **performance tiers** (Bronze→Platinum) shown in the rider app; shifts and reviews still missing |
| Employees and roles | Built |
| Transactions: collect cash, withdrawals, disbursements | Partial: ledger and payments views |
| Reports: transactions, orders, foods, restaurants, tax, expenses | Partial: dashboard charts + **per-restaurant performance scorecards** (acceptance/fulfilment/cancellation rates, avg prep time, GMV and a 0–100 score over 7/30/90 days, scoped to the branches the viewer can see) at Commerce → Performance des restaurants — the Uber Top Eats / Just Eat Performance Score equivalent StackFood lacks |
| Business settings (order, refund, restaurant, rider, customer rules, maintenance) | Partial: country profile, no settings screens |
| Third-party setup: payment, SMS, mail, map, push, social login | Partial: payment connectors in code |
| Landing page, pages and social media, languages, theme | Missing |
| Audit log and markets | Built (new; not in StackFood) |

## What it takes

Closing this means building about 120 screens across the customer, restaurant, rider and admin products.
It also means about 40 API features, plus messaging, push notifications and map adapters.
Each screen builds on the engine that already exists, so the work is wide rather than deep, and it parallelises well.

## Real content imported from the legacy catalogue (2026-10-05)

All 15 live Kinshasa restaurants on cd.tunakula.com (ROLLS, Mehfil, Lagrâce Cuisine, BigBite, MALAMU, Tacos Land, Loving Hut, MOOD, Tunakula, J-FAST FOOD, NickyB ETS, LA TREIZIÈME, JMM Hope, Bin's Restaurant, Le balcon Kintambo) — their names, addresses, cuisines, ratings and full menus (898 dishes with real prices) — were read from the legacy public catalogue API and now drive the website's storefronts, replacing the earlier illustrative samples. To keep the repository small, each restaurant's logo and cover are stored locally (30 images) while dish photos are served from their live catalogue URLs. Pipeline (all in `frontend/customer`):

- `scripts/import-legacy.mjs` (`npm run import:legacy`) — pulls **every restaurant the catalogue API currently serves** (all zones), with full menus and photos, and regenerates the two files below. The API only publishes restaurants that are active, approved and in a served zone; ones pending approval, disabled or unzoned are withheld by the platform from every public endpoint, so they appear automatically the moment they are activated in admin — the same command then imports them all with no code change.
- `lib/catalogue.source.json` — canonical snapshot the importer writes (prices kept in the restaurants' own USD).
- `scripts/fetch-fx.mjs` (`npm run fx:update`) — fetches a live USD→CDF rate from free, no-key providers into `lib/fx-rate.json`; falls back to the committed rate when the network is restricted.
- `scripts/build-catalogue.mjs` (`npm run catalogue:build`) — regenerates `lib/catalogue.ts`, converting USD→CDF at the fetched rate (rounded to 100 FC).
- `public/photos/` — the imported images; `public/photos/SOURCES.tsv` records each file's source URL.

The legacy `is_halal`/`veg` flags are blanket defaults (even pork was flagged halal), so they were dropped rather than shown as dietary claims.

The storefronts now read this catalogue **live from the browser**: `lib/live-catalogue.ts` fetches the restaurant list and each menu from the CORS-open catalogue API (`NEXT_PUBLIC_LEGACY_API`, default cd.tunakula.com), converts USD→CDF with a live free-FX rate, and `components/live.tsx` (`LiveMenu`, `LiveMerchantGrid`) swaps the fresh data into the server-rendered snapshot. With JavaScript off or the API unreachable, the committed snapshot shows instead, so pages are never blank.

The complete legacy functionality inventory — ~130 API endpoints across customer, business, rider and admin, with probe evidence and the platform's config flags (wallet, loyalty, referrals, coupons, cashback, subscriptions, scheduled orders, take-away, Stripe, offline payment) — is in [`legacy-feature-surface.md`](legacy-feature-surface.md). It was built from the public app bundles and unauthenticated API probes; the admin panel's own screens sit behind a login captcha and still need a read-only session, and the authenticated vendor/rider endpoints need an app token, to capture fully.
