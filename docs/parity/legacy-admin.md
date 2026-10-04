# Legacy Tunakula admin panel — parity checklist

Source: screens of the legacy admin panel (cd.tunakula.com/admin, StackFood-based, software 8.0) supplied
by the owner on 2026-10-04. **Benchmark only** (clean-room rule, PRD §1): structure and capabilities are
recorded here; no code, schema, copy or personal data is taken. Customer names and phone numbers that
appeared in the screens are deliberately not recorded.

Status: **Built** = in the new platform with tests · **API** = backend built, console screen pending ·
**Planned** = specified, not built.

## Navigation (legacy menu → new console)

| Legacy group | Legacy entries | New console | Status |
| --- | --- | --- | --- |
| Tableau de bord | Dashboard by zone and period | Overview (role-scoped analytics) | API |
| Point de vente | POS | Point of sale | Planned |
| Gestion des commandes | Ordres; Ordres d'abonnement; Gestion des expéditions (recherche de livraison, ordres en cours); Remboursement de commande | Orders (state groups), subscriptions, dispatch board, refunds | API (orders) / Planned |
| Gestion des restaurants | Configuration de la zone; cuisine; restaurants | Zones; cuisines; merchants and branches | API (branches) / Planned |
| Gestion des aliments | catégories; addons; aliments | Menu categories, add-ons, items | API (items, availability) / Planned |
| Gestion des promotions | campagnes; coupons; cashback; bannières; bannière promotionnelle; publicité; notification push | Promotions (merchant- vs platform-funded), banners, ads, push | Planned |
| Aide et soutien | Chat; Messages de contact | Support inbox with AI first line and takeover | Planned |
| Gestion des clients | clients; portefeuille; point de fidélité; liste de messagerie abonnée | Customers, wallet, loyalty, subscribers (consent) | Planned |
| Gestion du livreur | catégories de véhicules; configuration des shifts; livreurs | Riders, vehicle types, shifts, cash in hand | Planned |
| Gestion des décaissements | Décaissement restaurant; décaissement livreur | Payout runs from ledger balances | Planned |
| Gestion des rapports | transactions; dépenses; décaissements; aliments; commandes; restaurants; clients | Reports with CSV export | API (analytics) / Planned |
| Gestion des transactions | percevoir de l'argent; retraits restaurant; paiements de livraison; méthodes de retrait | Collect cash, withdrawals, rider payouts, payout methods | Planned |
| Gestion des employés | rôle d'employé; employés | Team and roles (scoped, no escalation) | API |
| Paramètres d'entreprise | configuration; modèles de messagerie; thème; galerie; connexion; pages et médias sociaux | Market settings (Country Profile), templates, brand, media | Built (config, brand) / Planned |
| Paramètres du système | tiers et configurations; app et web; canaux de notification; page de destination; site React; base de données; addons système | Connectors, notification channels, website content | Built (payment connectors) / Planned |

## Dashboard widgets

| Legacy widget | New equivalent |
| --- | --- |
| Order statistics by zone and period (overall, year, month, week, today): delivered, cancelled, refunded, payment failed | KPI tiles with deltas; state groups; period presets; zone filter |
| Unassigned, accepted by rider, cooking, picked up | Live dispatch board |
| Admin commission, total sales | Platform revenue (service charge + delivery-fee share); delivered order value. Commission is 0% |
| User statistics | New vs returning customers; active riders and merchants |
| Popular / top restaurants | Top merchants by delivered value and orders |
| Top rider | Rider leaderboard |
| Top-rated foods, best-selling foods | Top dishes by quantity; top rated after reviews (§14) |

## Orders list

- Status tabs: all, scheduled, pending, accepted, processing, food on the way, delivered, cancelled,
  payment failed, refunded, dine-in, offline payments.
- Columns: order id, date and time, customer, restaurant, total, payment status, order status, order type
  (home delivery, takeaway), actions. Search by order id. Paginated by 25.
- Observed in the legacy data (aggregate only): 109 orders, 57 delivered, 52 cancelled; most cancellations
  were unpaid. Payment completion is the largest leak the new checkout must close.

## Subscription orders

- Columns: subscription id, order type, duration, restaurant, customer, status, action. 0 records at review.

## Shipments

- "Recherche de livraison" (orders searching for a rider) and "ordres en cours" (in progress), each with
  order, date, customer, restaurant, total, status, actions.

## Zones

- 34 zones: the DRC provinces, Kinshasa districts (Lukunga, Mont-Amba, Tshangu, Funa), "Kinshasa 2", "UK",
  "All", and a company zone. Most have no restaurants; Lukunga has 12.
- A zone is a polygon of at least 3 points drawn on a map, with a business name and a display name per
  language (EN, FR), a veg / non-veg default, restaurant and rider counts and a status.
- A zone does not work until it has a minimum delivery fee and a per-km fee. New platform: fees come from
  the Country Profile's delivery ladder (§18.3) with per-zone overrides, validated before publish.

## Restaurants

- Submenu: add restaurant, restaurant list, new join requests (merchant applications awaiting review),
  bulk import, bulk export.
- New platform: merchant applications go through KYB before approval (§7); bulk import validates every row
  (prices in minor units per currency, allergens) and reports errors per row before anything is written;
  export is CSV per market.

## Food management

- Categories: category, sub-category, bulk import, bulk export.
- Add-ons: list, bulk import, bulk export.
- Items (aliments).
- New platform: categories nest one level (category → sub-category) per branch or market, names per
  language; add-on groups carry min/max selections and prices per currency in minor units; the same
  row-validated bulk import and CSV export as merchants.

## Cuisines

- 13 cuisines with restaurant counts: Américaine, Asiatique, Africaine, Européenne, Chinoise, Turque,
  Libanaise, Indienne, Swahili, Luba, Kongo, Ngala, Kinoise (10 restaurants, the largest).
- New platform: cuisines are a catalogue taxonomy per market and language, used for search and the
  "What are you craving?" rail.

## Business settings (configuration des entreprises)

Tabs: business settings, priority setup, orders, refund settings, restaurant, rider, customers, language,
landing page, disbursement.

| Legacy setting | New platform |
| --- | --- |
| Maintenance mode for selected systems at a chosen date and time | Specified: per market and per surface (ordering, merchant, rider), scheduled, audited; status page shows it |
| Company name, email, phone, country, address, map pin | Country Profile `experience` and the legal notice; contact inbox info@tunakula.com |
| Logo (3:1) and favicon (1:1) | Brand logos (ADR 0012): the supplied logo, unaltered, guarded byte-for-byte |
| Time zone, 12/24-hour time | Country Profile `country.timezones`; time format follows the locale |
| Currency, symbol position, decimals | Currency Registry (ISO 4217 minor units) and locale formatting; never a free choice per screen |
| Copyright and cookie text | Website legal pages (16 policies) |
| Default commission %, delivery-fee commission % | 0% merchant commission (fixed by policy); platform keeps 30% of the delivery fee (`rider_share_bps` 7000) |
| Free delivery above an amount; free delivery distance (km) | Specified: Country Profile pricing thresholds (legacy promise: free above $200) |
| Veg / non-veg option | Item tags (Vegan, Vegetarian, Halal) and allergens |
| Commission model / subscription model | Business models in the Country Profile (`operations.business_models`); merchant plans specified |
| Include tax in amount | Specified: tax provider port; all-in display already supported by the pricing engine |
| Admin order notification (type) | Notification channels per role |
| Processing fee (name + amount) | The 10% service charge, shown as its own line (`service_charge_bps`) |
| Partial payment (rest by cash, digital or both) | Specified: wallet + one other method per order |
| Guest checkout | Phone sign-in is one step; guest checkout is a decision for the owner |
| Campaign picker | Promotions module |

## Priority setup (configuration de la priorité)

The legacy panel sets the sort order of every customer-app list, each "default" or "custom condition":
category list, cuisine list, popular food nearby, popular restaurants, new restaurants, restaurant lists
(all, by category, by cuisine), food campaigns, best-reviewed food, category foods, search results.

New platform: rankings come from A23 Merit and Visibility — standing computed from published inputs
(distance, delivery reliability, ratings with minimum sample, recency), explained to merchants, never
for sale. Each surface has a default ranking and owner-approvable weights (A23 runs weights at L1).
Paid placement exists only in slots labelled "Sponsored" (ads, §12).

## Order settings (ordres)

| Legacy setting | New platform |
| --- | --- |
| Order delivery verification (on/off) | Always on: recipient code and custody gates (§11); never switchable off |
| Order types: home delivery, takeaway, dine-in | Built: DELIVERY, TAKEAWAY (counter handover fixed 2026-10-04), DINE_IN; per market in the Country Profile |
| Instant order, repeat order, subscription order, scheduled delivery, custom date order | SCHEDULED built as an order type; repeat ("order again") and subscriptions specified |
| Restaurant can cancel / rider can cancel | Policy per market: restaurants REJECT before acceptance; riders FAIL_DELIVERY with evidence or hand back for reassignment; customers cancel before acceptance |
| Order confirmation model: restaurant or rider | Built: `operations.confirmation_model` RESTAURANT_FIRST / RIDER_FIRST / AGENT_OPTIMISED per market |
| Scheduled delivery time interval (minutes); how many days ahead customers may order | Specified: Country Profile fields for slot length and booking window |
| Cancellation reasons per user type (customer, restaurant, rider, admin), per language; users cannot cancel unless a reason exists | Specified: managed reason catalogue per market and actor, with translations; the API's `reasonCode` must be one of them. Legacy examples: customer — service issue, found a better offer, ordered by mistake, change of plans, unforeseen event, payment problem, app problem, rider issues, restaurant issues, changed mind; rider — theft, road closures, traffic, reassignment, technical failure, safety concerns, multiple orders, illness, accident or emergency |

## Refund settings (remboursement)

| Legacy setting | New platform |
| --- | --- |
| Refund request mode on/off; customers cannot request a refund unless a reason exists | Built: REFUND_REQUESTED → REFUNDED states. Specified: managed refund-reason catalogue per market (default + FR/EN), same mechanism as cancellation reasons; reason required |
| Legacy reasons: wrong order, damaged order, missing items | Seeded as the starting catalogue (FR/EN), each with active/inactive status |

## Restaurant settings (restaurant)

| Legacy setting | New platform |
| --- | --- |
| Restaurant can cancel an order | Market policy: REJECT before acceptance only; after acceptance a cancel goes through support with a reason |
| Restaurant self-registration | Merchant onboarding with KYB review; never live without compliance approval |
| Restaurant can reply to reviews | Specified: one public reply per review, moderated |
| Extra packaging charge | Specified: per-branch packaging fee, shown as its own line on the receipt |
| Cash-in-hand overflow; maximum cash held; minimum amount to pay | Specified: COD exposure limits per merchant in the Country Profile, enforced from the ledger (cash held = COD collected − remitted) |

## Rider settings (livreur)

| Legacy setting | New platform |
| --- | --- |
| Tips for riders | Specified: tip line passed 100% to the rider via the ledger |
| Show earnings in app | Rider app shows ledger-backed earnings, always on |
| Rider self-registration | Rider onboarding with ID and vehicle checks before the RIDER role is granted |
| Maximum concurrent orders | Specified: dispatch limit per market (`dispatch.max_active_jobs`) |
| Rider can cancel | Hand back for reassignment or FAIL_DELIVERY with evidence; never a silent cancel |
| Maximum cash delivery; cash-in-hand overflow; minimum remittance | Specified: per-rider COD limits from the ledger; over the limit, dispatch offers prepaid jobs only |
| Photo to complete delivery | Built: custody evidence at handover (photo/code), required per market |

## Customer settings (clients)

| Legacy setting | New platform |
| --- | --- |
| Wallet: earn and spend, refund to wallet, add funds | Specified: customer wallet as ledger accounts; refund to wallet or original method; top-up via BitriPay |
| Loyalty points: points per 1 USD, % earned per order, minimum to convert | Specified: loyalty as a ledger liability with a published earn rate and expiry; values are owner inputs |
| Referral: reward to the sharer (USD); first-order discount for the new user (% or amount, validity in days/months/years) | Specified: referral programme in Promotions; legacy promise of $5 recorded as an owner input to confirm |
