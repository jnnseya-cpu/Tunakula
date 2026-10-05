# Gap against the legacy StackFood platform (honest inventory, 2026-10-04)

The legacy Tunakula runs on StackFood v8. It has four products: a customer app and website, a restaurant panel and app, a deliveryman app, and an admin panel with roughly 150 screens.
The new platform matches or beats it on the core engine: orders, custody, payments, ledger, roles, per-country rules, audit, distance and delivery time.
Most of what people see and touch is still missing. The rows below say plainly what exists.

Legend: **Built** works end to end · **Partial** the engine or a screen exists, not the full feature · **Missing** nothing usable yet.

## Customer (app and website)

| Feature | Status |
| --- | --- |
| Home: banners, categories, nearby restaurants, popular dishes | Partial: website shows the real Kinshasa restaurants (names, menus, logos, covers and dish photos imported from the legacy catalogue on 2026-10-05); still rendered from a built-in snapshot, not yet the live API |
| Distance (km) and delivery time per restaurant | Built (API and website) |
| Sign up / sign in by phone code | Built (SMS or WhatsApp code; delivery needs the messaging adapter) |
| Search with filters (veg, rating, price, cuisine, distance) | Partial: text search and sort only |
| Restaurant page with menu | Built: live menu, availability, allergens, distance, time, fee |
| Food details: variations, add-ons, notes | Missing |
| Cart and checkout: delivery, takeaway, dine-in, scheduled | Built for delivery and takeaway (live quote, directions, tip); dine-in and scheduled missing |
| Pay: mobile money, card, cash, wallet, partial payment | Built: mobile money, card, cash on delivery; wallet and partial payment missing |
| Coupons, cashback, campaigns | Missing |
| Live order tracking with map and rider | Built: live progress, door code, rider name, distance, arrival time and a map (kitchen, rider, door); street tiles need a map provider key |
| Order history, reorder, cancel with reason, refund request | Built: history, order again, cancel; refund request missing |
| Reviews and ratings | Missing |
| Chat with restaurant and rider; push and SMS notifications | Missing |
| Wallet, loyalty points, referral | Missing |
| Saved addresses with map pin | Missing |
| Favourites | Missing |
| Subscription (repeat) orders | Missing |
| Languages FR / EN / LN / SW, dark mode | Missing (English only) |
| Native Android / iOS apps | Missing |

## Restaurant (panel and app)

| Feature | Status |
| --- | --- |
| Dashboard and reports | Partial: admin dashboard scoped to the owner's branches |
| Live orders: accept, prepare, ready, hand over | Built: live kitchen board with sound, accept/reject with reason, cook, pack (line check, allergens, bags), ready (labels, seals, photo), counter handover with code |
| POS | Missing |
| Menu: foods, categories, variations, add-ons, availability, bulk import | Partial: items and availability only |
| Opening hours, schedule, temporary close | Partial: pause and resume taking orders (audited); weekly hours missing |
| Coupons, campaigns, ads | Missing |
| Reviews and replies | Missing |
| Wallet, withdrawals, earnings | Partial: ledger only |
| Employees and roles | Partial: team page (admin) |
| Self-registration and onboarding | Missing |

## Deliveryman (app)

| Feature | Status |
| --- | --- |
| Go online / offline, shifts | Built: online/offline with GPS (position shared only while online or carrying an order); shifts missing |
| Job offers, accept, navigation, pick up, deliver with code and photo | Built: automatic nearest-rider offers (30 s, earnings shown first, no penalty for saying no), navigation links, bag check at pickup, code + GPS + photo at the door, failed-delivery report |
| Earnings, wallet, cash in hand, remittance | Partial: earnings, cash in hand, cash hand-in at the hub (posted to the ledger); withdrawals missing |
| Vehicles, documents, self-registration | Built: apply with ID, selfie and licence photos, automatic checks (age, ID format, duplicate ID, licence and plate), review and approval by operations |

## Admin

| Area | Status |
| --- | --- |
| Dashboard with charts per role | Built |
| Orders list, detail, cancel | Built |
| Dispatch management (assign or reassign riders, live map) | Built: automatic dispatch, kitchen timeouts, live dispatch screen with map, rider statuses, assign/reassign, refunds needing attention |
| Refunds | Partial: automatic full refunds for paid orders that end before delivery, with retries; refunds after delivery missing |
| Zones (polygons, fees per zone) | Missing |
| Cuisines, categories, add-ons, foods, bulk import/export | Partial: per-restaurant menu only |
| Restaurants: list, add, join requests, commission/plan | Partial: list and menu |
| Promotions: campaigns, banners, coupons, cashback, push, ads | Missing |
| Customers: list, wallet, loyalty, subscribers | Missing |
| Deliverymen: list, vehicles, shifts, reviews, bonuses, join requests | Partial: rider list with status and cash, join requests with ID review; shifts, reviews and bonuses missing |
| Employees and roles | Built |
| Transactions: collect cash, withdrawals, disbursements | Partial: ledger and payments views |
| Reports: transactions, orders, foods, restaurants, tax, expenses | Partial: dashboard charts only |
| Business settings (order, refund, restaurant, rider, customer rules, maintenance) | Partial: country profile, no settings screens |
| Third-party setup: payment, SMS, mail, map, push, social login | Partial: payment connectors in code |
| Landing page, pages and social media, languages, theme | Missing |
| Audit log and markets | Built (new; not in StackFood) |

## What it takes

Closing this means building about 120 screens across the customer, restaurant, rider and admin products.
It also means about 40 API features, plus messaging, push notifications and map adapters.
Each screen builds on the engine that already exists, so the work is wide rather than deep, and it parallelises well.

## Real content imported from the legacy catalogue (2026-10-05)

The four live Kinshasa restaurants on cd.tunakula.com (Lagrâce Cuisine, Bin's Restaurant, NickyB ETS, Tacos Land) — their names, addresses, cuisines, ratings, full menus (85 dishes with real prices), logos, covers and every dish photo — were read from the legacy public catalogue API and now drive the website's storefronts, replacing the earlier illustrative samples. Pipeline (all in `frontend/customer`):

- `lib/catalogue.source.json` — canonical snapshot (prices kept in the restaurants' own USD).
- `scripts/fetch-fx.mjs` (`npm run fx:update`) — fetches a live USD→CDF rate from free, no-key providers into `lib/fx-rate.json`; falls back to the committed rate when the network is restricted.
- `scripts/build-catalogue.mjs` (`npm run catalogue:build`) — regenerates `lib/catalogue.ts`, converting USD→CDF at the fetched rate (rounded to 100 FC).
- `public/photos/` — the imported images; `public/photos/SOURCES.tsv` records each file's source URL.

The legacy `is_halal`/`veg` flags are blanket defaults (even pork was flagged halal), so they were dropped rather than shown as dietary claims.
