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
