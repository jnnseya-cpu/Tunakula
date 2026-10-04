# Gap against the legacy StackFood platform (honest inventory, 2026-10-04)

The legacy Tunakula runs on StackFood v8. It has four products: a customer app and website, a restaurant panel and app, a deliveryman app, and an admin panel with roughly 150 screens.
The new platform matches or beats it on the core engine: orders, custody, payments, ledger, roles, per-country rules, audit, distance and delivery time.
Most of what people see and touch is still missing. The rows below say plainly what exists.

Legend: **Built** works end to end · **Partial** the engine or a screen exists, not the full feature · **Missing** nothing usable yet.

## Customer (app and website)

| Feature | Status |
| --- | --- |
| Home: banners, categories, nearby restaurants, popular dishes | Partial: website only, sample data, not from the API |
| Distance (km) and delivery time per restaurant | Built (API and website) |
| Sign up / sign in by phone code | Partial: API only, no screen |
| Search with filters (veg, rating, price, cuisine, distance) | Partial: text search and sort only |
| Restaurant page with menu | Partial: sample data only |
| Food details: variations, add-ons, notes | Missing |
| Cart and checkout: delivery, takeaway, dine-in, scheduled | Partial: API built, basket screen without checkout |
| Pay: mobile money, card, cash, wallet, partial payment | Partial: API built (mobile money, cash); no screen; no wallet |
| Coupons, cashback, campaigns | Missing |
| Live order tracking with map and rider | Partial: API states only, no screen |
| Order history, reorder, cancel with reason, refund request | Partial: API only |
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
| Live orders: accept, prepare, ready, hand over | Partial: API built, no kitchen screen |
| POS | Missing |
| Menu: foods, categories, variations, add-ons, availability, bulk import | Partial: items and availability only |
| Opening hours, schedule, temporary close | Missing |
| Coupons, campaigns, ads | Missing |
| Reviews and replies | Missing |
| Wallet, withdrawals, earnings | Partial: ledger only |
| Employees and roles | Partial: team page (admin) |
| Self-registration and onboarding | Missing |

## Deliveryman (app)

| Feature | Status |
| --- | --- |
| Go online / offline, shifts | Missing |
| Job offers, accept, navigation, pick up, deliver with code and photo | Partial: API built, no app |
| Earnings, wallet, cash in hand, remittance | Partial: ledger only |
| Vehicles, documents, self-registration | Missing |

## Admin

| Area | Status |
| --- | --- |
| Dashboard with charts per role | Built |
| Orders list, detail, cancel | Built |
| Dispatch management (assign or reassign riders, live map) | Missing |
| Refunds | Partial: API |
| Zones (polygons, fees per zone) | Missing |
| Cuisines, categories, add-ons, foods, bulk import/export | Partial: per-restaurant menu only |
| Restaurants: list, add, join requests, commission/plan | Partial: list and menu |
| Promotions: campaigns, banners, coupons, cashback, push, ads | Missing |
| Customers: list, wallet, loyalty, subscribers | Missing |
| Deliverymen: list, vehicles, shifts, reviews, bonuses, join requests | Missing |
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
