# Parity register (Appendix B)

Generated from PRD Appendix B; statuses are maintained in `register.json` (CMP-003).

**152 capabilities** — DOMAIN: 23, NOT_STARTED: 119, PARTIAL: 7, REPLACED: 3

| Section | Capability | Parity | Status | Evidence |
| --- | --- | --- | --- | --- |
| B.1 | Language selection and multi-language UI | M | PARTIAL | Locales in Country Profile and config; no UI |
| B.1 | Multiple login methods (manual, OTP, social) | M | NOT_STARTED |  |
| B.1 | Firebase/mobile OTP and two-factor options | M | NOT_STARTED |  |
| B.1 | Guest checkout | M | NOT_STARTED |  |
| B.1 | Location setup and address management with labels | M | NOT_STARTED |  |
| B.1 | Delivery instructions at checkout | M | PARTIAL | Structured allergen flags vs advisory notes in the order aggregate (services/api ordering) |
| B.1 | Home page with promotional banners | M | NOT_STARTED |  |
| B.1 | Search bar, deep search, tags, voice search | M | NOT_STARTED |  |
| B.1 | Favourites and wishlist | M | NOT_STARTED |  |
| B.1 | Cart, restaurant-wise cart, cross-module cart sync | M | NOT_STARTED |  |
| B.1 | Running order view and live tracking | M | PARTIAL | Proof-of-delivery evidence bundle only (ordering/evidence.ts); no tracking |
| B.1 | Order history and reorder | M | NOT_STARTED |  |
| B.1 | Scheduled delivery (30-minute slots) | M | NOT_STARTED |  |
| B.1 | Subscription ordering (daily, weekly, monthly, custom, slot-based) | S | NOT_STARTED |  |
| B.1 | Coupons | M | NOT_STARTED |  |
| B.1 | Wallet with top-up and partial payment | M | PARTIAL | Per-currency ledger accounts exist; no wallet product |
| B.1 | Loyalty points and conversion to wallet | M | NOT_STARTED |  |
| B.1 | Referral with earnings and first-order discount | M | NOT_STARTED |  |
| B.1 | Join as deliveryman / open restaurant from the app | M | NOT_STARTED |  |
| B.1 | Live chat and help & support | M | NOT_STARTED |  |
| B.1 | Ratings and reviews for restaurant and rider | M | NOT_STARTED |  |
| B.1 | Legal pages | M | NOT_STARTED |  |
| B.1 | Customer profile and self-delete account | M | DOMAIN | Account deletion with blockers, grace period, pseudonymisation (identity/accounts.ts) |
| B.1 | Dark and light mode | M | DOMAIN | Light/dark design tokens served at runtime (config/brand.ts) |
| B.1 | Veg/non-veg filter, allergy and nutrition tags, halal tag | M | PARTIAL | Allergen acknowledgement gate at packing (ordering) |
| B.1 | Food without image; image zoom | M | NOT_STARTED |  |
| B.1 | AI chatbot for assistance and product search | M | NOT_STARTED |  |
| B.1 | AI personalised home page | M | NOT_STARTED |  |
| B.1 | Restaurant reels / promotional content | C | NOT_STARTED |  |
| B.1 | Order editing after placement | M | NOT_STARTED |  |
| B.1 | Order cancellation | M | NOT_STARTED |  |
| B.1 | WhatsApp ordering | NEW | NOT_STARTED |  |
| B.1 | Cross-border "send a meal home" | NEW | NOT_STARTED |  |
| B.1 | Multi-currency display and payment | NEW | DOMAIN | Currency Registry, Money, FX quotes, flags (packages/ts-money) |
| B.1 | Group ordering and gifting | NEW | NOT_STARTED |  |
| B.1 | Table booking and scheduled collection | NEW | NOT_STARTED |  |
| B.2 | Company and business rules setup | M | DOMAIN | Country Profile schema, validation, versioned publish (ts-contracts, config) |
| B.2 | Multiple business models (commission, subscription) | M | DOMAIN | business_models in Country Profile; 0% commission enforced in pricing |
| B.2 | Order verification model (restaurant-first or rider-first) | M | DOMAIN | RIDER_FIRST / AGENT_OPTIMISED in the order aggregate |
| B.2 | Home delivery and takeaway toggles | M | NOT_STARTED |  |
| B.2 | Scheduled delivery settings | M | NOT_STARTED |  |
| B.2 | Order cancellation and refund settings | M | NOT_STARTED |  |
| B.2 | Deliveryman settings | M | NOT_STARTED |  |
| B.2 | Restaurant settings | M | NOT_STARTED |  |
| B.2 | Customer settings | M | NOT_STARTED |  |
| B.2 | Language settings and auto-translate | M | NOT_STARTED |  |
| B.2 | Email templates and push notification templates | M | NOT_STARTED |  |
| B.2 | Theme settings | M | DOMAIN | Brands and themes served at runtime, WCAG-validated |
| B.2 | Gallery / media library | M | NOT_STARTED |  |
| B.2 | Social media links | M | NOT_STARTED |  |
| B.2 | Legal pages management | M | NOT_STARTED |  |
| B.2 | Employee roles and management | M | DOMAIN | Scoped RBAC + business accounts with per-member access levels |
| B.2 | Zone setup with map drawing | M | NOT_STARTED |  |
| B.2 | Cuisine setup | M | NOT_STARTED |  |
| B.2 | Food category and subcategory setup | M | NOT_STARTED |  |
| B.2 | Food addons and attributes | M | NOT_STARTED |  |
| B.2 | Food settings (stock types, low-stock warnings) | M | NOT_STARTED |  |
| B.2 | Dynamic 12/24 hour format, time zone | M | NOT_STARTED |  |
| B.2 | Maintenance mode with module control | M | DOMAIN | Feature flags per market/city/brand/segment (config/feature-flags.ts) |
| B.2 | Clean database / test data deletion | M | NOT_STARTED |  |
| B.2 | ReCAPTCHA and bot protection | M | NOT_STARTED |  |
| B.2 | Landing page settings | M | NOT_STARTED |  |
| B.2 | App and web settings, app version control | M | NOT_STARTED |  |
| B.2 | Third-party configuration (maps, SMS, mail, storage) | M | NOT_STARTED |  |
| B.3 | Add and manage restaurants (unlimited) | M | NOT_STARTED |  |
| B.3 | Restaurant verification badge | M | NOT_STARTED |  |
| B.3 | Restaurant self-registration toggle | M | NOT_STARTED |  |
| B.3 | Order details and management | M | DOMAIN | Order aggregate, evidence bundle, idempotent store |
| B.3 | Subscription orders management | S | NOT_STARTED |  |
| B.3 | Order refunds management | M | NOT_STARTED |  |
| B.3 | Dispatch management with manual assignment | M | NOT_STARTED |  |
| B.3 | Order reassignment to another rider | M | NOT_STARTED |  |
| B.3 | Deliveryman management and verification | M | NOT_STARTED |  |
| B.3 | Freelance or salaried rider models | M | NOT_STARTED |  |
| B.3 | Restaurant-wise rider assignment | M | NOT_STARTED |  |
| B.3 | Maximum assigned orders per rider | M | NOT_STARTED |  |
| B.3 | Shift setup and online time logging | M | NOT_STARTED |  |
| B.3 | Vehicle categories with coverage and extra charges | M | NOT_STARTED |  |
| B.3 | Rider incentives and bonuses | M | NOT_STARTED |  |
| B.3 | Cash in hand and overflow control | M | PARTIAL | COD cash caps per currency in Country Profile; no rider float tracking yet |
| B.3 | Collect cash from deliverymen | M | NOT_STARTED |  |
| B.3 | Delivery proof managed by rider | M | DOMAIN | Recipient code, per-drop scan, geofence in the order aggregate |
| B.3 | Live tracking of riders | M | NOT_STARTED |  |
| B.3 | Multiple delivery speed options (standard, express, delayed) | S | NOT_STARTED |  |
| B.3 | ETA calculation | M | NOT_STARTED |  |
| B.3 | Customer management | M | NOT_STARTED |  |
| B.3 | Chatting and contact messages | M | NOT_STARTED |  |
| B.3 | Subscribed emails and export | S | NOT_STARTED |  |
| B.3 | Restaurant withdrawals | M | NOT_STARTED |  |
| B.3 | Deliveryman payments | M | NOT_STARTED |  |
| B.3 | Employee login with dynamic URLs | D | NOT_STARTED |  |
| B.4 | Commission on orders (default and per restaurant) | M | REPLACED | Superseded by §18.1: 0% commission enforced in pricing |
| B.4 | Commission on delivery charges | M | DOMAIN | Rider 70% / platform 30% split in settlement currency (pricing) |
| B.4 | Zone-wise, restaurant-wise, distance, area and ZIP delivery charges | M | PARTIAL | Distance ladder with rural rate (pricing); zones not built |
| B.4 | Surge pricing | S | DOMAIN | Zone-level capped surge with suppression (pricing) |
| B.4 | Free delivery by order amount or distance | M | DOMAIN | Merchant-funded delivery promotion (pricing) |
| B.4 | Extra packaging charge | M | NOT_STARTED |  |
| B.4 | Service charge / platform fee | M | DOMAIN | 10% service charge, all-in display, proportional refund (pricing) |
| B.4 | Rider tips | M | DOMAIN | Tips 100% to rider, posted to rider_payable (pricing) |
| B.4 | Dashboard | M | NOT_STARTED |  |
| B.4 | Transaction and expense reports | M | DOMAIN | Double-entry journals and nightly ledger proof (money) |
| B.4 | Food and customer reports | M | NOT_STARTED |  |
| B.4 | Restaurant and order reports | M | NOT_STARTED |  |
| B.4 | Day, week and month earnings with automatic payout lists | M | NOT_STARTED |  |
| B.4 | Customer overview report (orders, reviews, wallet, loyalty, referral) | M | NOT_STARTED |  |
| B.4 | Export and import | M | NOT_STARTED |  |
| B.4 | Multi-currency | NEW | NOT_STARTED |  |
| B.4 | Double-entry ledger | NEW | NOT_STARTED |  |
| B.5 | Account information and configuration | M | NOT_STARTED |  |
| B.5 | Restaurant wallet | M | NOT_STARTED |  |
| B.5 | Restaurant subscription packages and free trial | M | NOT_STARTED |  |
| B.5 | Customer reviews and replies | M | NOT_STARTED |  |
| B.5 | Chat section | M | NOT_STARTED |  |
| B.5 | Categories and restaurant-wise categories | M | NOT_STARTED |  |
| B.5 | Foods, variations, addons | M | NOT_STARTED |  |
| B.5 | Stock management and low-stock warnings | M | NOT_STARTED |  |
| B.5 | Nutrition, allergy, halal and veg tags | M | NOT_STARTED |  |
| B.5 | AI product content generation and SEO data | M | NOT_STARTED |  |
| B.5 | Campaigns and coupons | M | NOT_STARTED |  |
| B.5 | Paid ads / storefront placement | S | NOT_STARTED |  |
| B.5 | POS section | M | NOT_STARTED |  |
| B.5 | Order and subscription reports | M | NOT_STARTED |  |
| B.5 | Expense report and dashboard | M | NOT_STARTED |  |
| B.5 | Deliveryman management by restaurant | M | NOT_STARTED |  |
| B.5 | Employee management and roles | M | DOMAIN | Business accounts: custom access levels, branch limits, POS authorisation actions |
| B.5 | Restaurant app: dashboard, food and rider management | M | NOT_STARTED |  |
| B.5 | Restaurant website builder (add-on) | C | NOT_STARTED |  |
| B.6 | Sign in and sign up | M | NOT_STARTED |  |
| B.6 | Dashboard and earnings | M | NOT_STARTED |  |
| B.6 | Order requests and acceptance | M | NOT_STARTED |  |
| B.6 | Order history | M | NOT_STARTED |  |
| B.6 | Activity status (online/offline) | M | NOT_STARTED |  |
| B.6 | Conversation with customer and restaurant | M | NOT_STARTED |  |
| B.6 | Profile settings and app configuration | M | NOT_STARTED |  |
| B.6 | Incentives | M | NOT_STARTED |  |
| B.6 | Biometric login | S | NOT_STARTED |  |
| B.6 | Delete account | M | DOMAIN | Account deletion flow (identity/accounts.ts) |
| B.6 | Cash in hand view | M | NOT_STARTED |  |
| B.6 | Offline-tolerant job flow | NEW | NOT_STARTED |  |
| B.6 | Fleet partner linkage | NEW | NOT_STARTED |  |
| B.7 | Payment gateways (Stripe, PayPal, Razorpay, Paytm, 2Checkout, Flutterwave, bKash, Liqpay, PayTabs and others) | M | DOMAIN | Payment Orchestration + certification; BitriPay, KODA, sandbox connectors |
| B.7 | Cash on delivery and manual/offline payment | M | DOMAIN | CASH_ON_DELIVERY method, COD policy and settlement journal |
| B.7 | COD converted to digital payment after completion | S | NOT_STARTED |  |
| B.7 | SMS gateways and SMS OTP | M | NOT_STARTED |  |
| B.7 | Firebase notifications and webhooks | M | DOMAIN | Signed, verified provider webhooks (connectors) |
| B.7 | Amazon S3 / cloud storage | M | NOT_STARTED |  |
| B.7 | Caching and performance optimisation | M | DOMAIN | SLO error budgets and release freeze (platform/slo.ts) |
| B.7 | Multi-language with RTL and auto-translate | M | NOT_STARTED |  |
| B.7 | ERP compatibility | C | NOT_STARTED |  |
| B.7 | Single currency per installation | D | REPLACED | Replaced: native multi-currency |
| B.7 | One installation per country | D | REPLACED | Replaced: Country Profile publishing |
| B.7 | Admin as web only | D | NOT_STARTED |  |

# Merged capability register (Appendix C)

**172 capabilities** — decisions: ADAPT: 9, ADOPT: 122, ADOPT and extend: 5, ADOPT and lead: 1, ADOPT from the start: 1, DEFER: 27, REJECT: 7; status: DOMAIN: 13, NOT_STARTED: 145, PARTIAL: 7, REJECTED: 6, REPLACED: 1

| Section | Capability | Seen on | Decision | Market-gated | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| C.1 | Unified search across food, grocery and retail in one bar | UE DD | ADOPT |  | NOT_STARTED |  |
| C.1 | Cuisine, dish and category browsing with carousels | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.1 | Personalised home feed from browsing and order behaviour | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.1 | Filters: dietary, allergen, price, rating, delivery time, offers | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.1 | Guest checkout without registration | SF DD JE | ADOPT |  | NOT_STARTED |  |
| C.1 | Group ordering with per-person carts | UE DD DL JE | ADOPT | yes | NOT_STARTED |  |
| C.1 | Scheduled orders in time slots | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.1 | Live order tracking with map and ETA | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.1 | Reorder, favourites, wishlists, lists | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.1 | Contactless and "leave at my door" | UE DD DL JE | ADOPT | yes | DOMAIN | Contactless only when chosen, with photo (ordering) |
| C.1 | Delivery instructions and access notes at checkout | UE DD DL JE | ADOPT |  | PARTIAL | Structured allergen flags; notes advisory (ordering) |
| C.1 | Gifting and sending an order to someone else | UE DD | ADAPT |  | NOT_STARTED |  |
| C.1 | Pickup, collection and takeaway | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.1 | Dine-in and tableside order and pay | UE DD | ADOPT |  | NOT_STARTED |  |
| C.1 | Curbside and drive-through collection | DD | ADOPT | yes | NOT_STARTED |  |
| C.1 | In-car ordering and voice assistants | JE UE | DEFER |  | NOT_STARTED |  |
| C.1 | Multi-store cart in one order | DL | DEFER |  | NOT_STARTED |  |
| C.2 | Separate quality and delivery ratings | JE | ADOPT |  | NOT_STARTED |  |
| C.2 | Median over a long window rather than a mean | JE | ADOPT |  | NOT_STARTED |  |
| C.2 | Minimum rated orders before a score is shown | DL | ADOPT |  | NOT_STARTED |  |
| C.2 | Rolling window of recent ratings | UE DD DL | ADOPT |  | NOT_STARTED |  |
| C.2 | Verified-order-only reviews | DD JE | ADOPT |  | NOT_STARTED |  |
| C.2 | Photo reviews, sometimes compensated | UE | ADOPT | yes | NOT_STARTED |  |
| C.2 | Item-level thumbs and most-liked items | UE DD | ADOPT |  | NOT_STARTED |  |
| C.2 | Merchant replies to reviews | SF UE DD DL | ADOPT |  | NOT_STARTED |  |
| C.2 | Templated or automatic replies | UE | ADOPT |  | NOT_STARTED |  |
| C.2 | AI review summarisation for merchants and customers | UE | ADOPT |  | NOT_STARTED |  |
| C.2 | Two-way courier rating by customers and merchants | UE DD | ADOPT |  | NOT_STARTED |  |
| C.2 | Ratings protection excluding causes outside the rated party's control | UE DD | ADOPT and extend |  | NOT_STARTED |  |
| C.2 | Removing reviews that focus on delivery | DD DL | REJECT |  | REJECTED |  |
| C.2 | Public per-rider star rating | UE DD | REJECT | yes | REJECTED |  |
| C.2 | Acceptance rate as a courier performance metric | DD (no minimum) DL (explicitly not used) | REJECT |  | REJECTED |  |
| C.2 | Earned quality badges from sustained performance | UE DD | ADOPT |  | NOT_STARTED |  |
| C.2 | Rating as a gate for access to marketing tools | DL | ADOPT |  | NOT_STARTED |  |
| C.2 | Official food hygiene rating displayed on listings | DL JE | ADOPT | yes | NOT_STARTED |  |
| C.2 | Written reviews kept private from the public | JE | ADAPT |  | NOT_STARTED |  |
| C.3 | Consumer subscription with free or reduced delivery | UE DD DL | ADAPT |  | NOT_STARTED |  |
| C.3 | Credit-back rewards on subscription spend | UE DD | DEFER |  | NOT_STARTED |  |
| C.3 | Family or household sharing of a subscription | DD | DEFER |  | NOT_STARTED |  |
| C.3 | Wallet with top-up and partial payment | SF | ADOPT |  | NOT_STARTED |  |
| C.3 | Loyalty points and conversion to wallet credit | SF | ADOPT |  | NOT_STARTED |  |
| C.3 | Merchant-run loyalty and stamp cards | DD JE | ADOPT | yes | NOT_STARTED |  |
| C.3 | Referral with rewards for both sides | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.3 | Gift cards and corporate gift cards | UE DD DL JE | DEFER | yes | NOT_STARTED |  |
| C.3 | Win-back and lapsed-customer campaigns | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.4 | Card, wallet and digital payment methods | SF UE DD DL JE | ADOPT |  | DOMAIN | Payment Orchestration, BitriPay/KODA connectors |
| C.4 | Cash on delivery | SF DL JE | ADAPT |  | PARTIAL | COD method and policy; CEO-dated exception not yet modelled (§29.6) |
| C.4 | Mobile money and local rails | SF | ADOPT and extend |  | DOMAIN | BitriPay mobile money push, KODA verification |
| C.4 | Split payment across methods | SF DD | ADOPT |  | NOT_STARTED |  |
| C.4 | Service fee charged to the customer | UE DD DL JE | ADOPT |  | DOMAIN | 10% service charge (pricing) |
| C.4 | Commission charged to the merchant | SF UE DD DL JE | REJECT |  | REPLACED | 0% commission enforced (pricing) |
| C.4 | Small-order fee | UE DD DL JE | DEFER | yes | NOT_STARTED |  |
| C.4 | Distance-based and zone-based delivery pricing | SF UE DD DL JE | ADOPT |  | PARTIAL | Distance ladder; zones not built |
| C.4 | Surge or busy pricing | SF UE DD | ADOPT |  | DOMAIN | Zone-level capped surge (pricing) |
| C.4 | Expanded-range fee for distant orders | DD | ADAPT |  | DOMAIN | 30% band steps beyond 7 km (pricing) |
| C.4 | Free delivery above an order threshold | SF UE DD DL JE | ADOPT |  | PARTIAL | Merchant-funded delivery promotion; threshold rule not built |
| C.4 | Tips, 100% to the courier | UE DD DL JE | ADOPT |  | DOMAIN | Tips to rider_payable (pricing) |
| C.4 | Post-delivery tipping window | DD DL | ADOPT |  | NOT_STARTED |  |
| C.4 | Transparent fee breakdown before payment | UE DD JE | ADOPT |  | DOMAIN | Named price lines and all-in display (pricing) |
| C.4 | Refunds to original method or wallet | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Merchant portal and mobile manager app | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Menu management with categories, variants and modifiers | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Bulk menu and catalogue import | SF UE DD DL JE | ADOPT and extend |  | NOT_STARTED |  |
| C.5 | Item availability and quick unavailable toggle | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Prep-time control and busy mode | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Opening hours, holiday hours, bulk open and close | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Multi-site and enterprise management | UE DD DL JE | ADOPT |  | PARTIAL | Business accounts with branches and branch-limited members |
| C.5 | Analytics, reporting and customer insight | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Built-in POS for walk-in orders | SF DD | ADOPT and extend |  | NOT_STARTED |  |
| C.5 | Own-website ordering and storefront builder | DD JE UE | ADOPT |  | NOT_STARTED |  |
| C.5 | POS and back-of-house integrations | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Order management tablet and printer support | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | AI menu descriptions, translation and photo enhancement | UE DD JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Professional photography service | DD | DEFER |  | NOT_STARTED |  |
| C.5 | Customer feedback dashboard with reply tools | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.5 | Merchant messaging to customers after a problem | UE | ADOPT |  | NOT_STARTED |  |
| C.5 | Reservations and table management | DD | ADOPT |  | NOT_STARTED |  |
| C.5 | Error charges levied on merchants for mistakes | DD | ADAPT |  | NOT_STARTED |  |
| C.5 | AI-generated menu imagery | DL (banned from Oct 2026) | REJECT |  | REJECTED |  |
| C.6 | Self-serve onboarding with background and document checks | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.6 | Offer and job acceptance with timeout | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.6 | Batched and stacked orders | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.6 | Earnings modes: per offer or per active hour | DD | DEFER | yes | NOT_STARTED |  |
| C.6 | Instant or same-day payout | UE DD | ADOPT |  | NOT_STARTED |  |
| C.6 | Incentives: quests, challenges, boosts, peak pay | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.6 | Shift booking and session planning | SF DL JE | ADOPT | yes | NOT_STARTED |  |
| C.6 | Heatmaps showing where demand is | UE | ADOPT |  | NOT_STARTED |  |
| C.6 | Safety toolkit, emergency button, trip sharing | UE DD | ADOPT |  | NOT_STARTED |  |
| C.6 | Phone number anonymisation | UE DD DL | ADOPT |  | NOT_STARTED |  |
| C.6 | Delivery PIN, photo and signature proof | UE DD DL JE | ADOPT |  | DOMAIN | Recipient code, photo, geofence (ordering) |
| C.6 | Employed courier model alongside self-employed | JE (Scoober) | ADAPT |  | NOT_STARTED |  |
| C.6 | Fleet partner accounts | — | ADOPT |  | NOT_STARTED |  |
| C.6 | Cash-in-hand tracking and overflow limits | SF | ADOPT |  | NOT_STARTED |  |
| C.6 | Rider equipment supply | DL JE | DEFER |  | NOT_STARTED |  |
| C.6 | Contract violations and lateness deactivation | DD | ADAPT |  | NOT_STARTED |  |
| C.7 | Algorithmic dispatch and assignment | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.7 | Restaurant-first or courier-first confirmation | SF | ADOPT |  | DOMAIN | RIDER_FIRST / AGENT_OPTIMISED (ordering) |
| C.7 | Zone and radius management | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.7 | Marketplace plus platform-delivery hybrid | JE | ADOPT |  | NOT_STARTED |  |
| C.7 | White-label delivery as a service to third parties | UE DD DL | DEFER |  | NOT_STARTED |  |
| C.7 | Dark stores and owned inventory | DD DL | REJECT |  | REJECTED |  |
| C.7 | Dark kitchens and virtual brands | UE DD DL | DEFER | yes | NOT_STARTED |  |
| C.7 | Autonomous vehicles, drones and sidewalk robots | UE DD JE | REJECT |  | REJECTED |  |
| C.7 | Large orders and catering | UE DD DL JE | ADOPT | yes | NOT_STARTED |  |
| C.7 | Returns and reverse logistics | DD | DEFER |  | NOT_STARTED |  |
| C.7 | Premium or priority delivery option | UE DD | DEFER | yes | NOT_STARTED |  |
| C.8 | Grocery and convenience | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.8 | Substitution preferences, per item or per basket | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.8 | Variable-weight items with authorise-then-capture | UE DD DL | ADOPT |  | NOT_STARTED |  |
| C.8 | Barcode scanning and in-store picking app | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.8 | Age-restricted goods with ID check at handover | UE DD DL JE | ADOPT | yes | NOT_STARTED |  |
| C.8 | Pharmacy and prescription delivery | UE DD JE | DEFER | yes | NOT_STARTED |  |
| C.8 | Retail, flowers, pet and general merchandise | UE DD | DEFER |  | NOT_STARTED |  |
| C.8 | Shop-for-me from any store, including unlisted ones | UE | DEFER |  | NOT_STARTED |  |
| C.8 | Food benefit and voucher scheme payments | DD (SNAP) JE (meal cards) | ADOPT | yes | NOT_STARTED |  |
| C.8 | Retailer loyalty card integration | DL | DEFER | yes | NOT_STARTED |  |
| C.9 | Sponsored listings and placement | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.9 | Sponsored items and dish promotion | UE DD JE | DEFER |  | NOT_STARTED |  |
| C.9 | Pay-per-order rather than per click | DD | ADOPT |  | NOT_STARTED |  |
| C.9 | Self-serve ads manager with reporting | UE DD DL | ADOPT |  | NOT_STARTED |  |
| C.9 | Offers, multibuy and percentage discounts | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.9 | Platform-funded promotional campaigns | UE DD | ADOPT |  | NOT_STARTED |  |
| C.9 | Retail media and non-endemic brand advertising | UE DD DL JE | DEFER |  | NOT_STARTED |  |
| C.9 | Offsite and programmatic advertising | DD DL | DEFER |  | NOT_STARTED |  |
| C.9 | Post-checkout and order-tracking page ads | UE DL JE | DEFER |  | NOT_STARTED |  |
| C.9 | CRM, push and lifecycle messaging | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.9 | Healthy-food advertising restrictions | DL (UK HFSS) | ADOPT | yes | NOT_STARTED |  |
| C.10 | Corporate accounts with budgets and policy controls | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.10 | Meal allowances per employee with day, time and category limits | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.10 | Team and group ordering for offices | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.10 | Office catering | UE DD DL JE | DEFER | yes | NOT_STARTED |  |
| C.10 | Consolidated invoicing and expense integrations | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.10 | Employee privacy by design in corporate reporting | JE | ADOPT |  | NOT_STARTED |  |
| C.10 | Physical or virtual corporate payment card | JE | DEFER |  | NOT_STARTED |  |
| C.10 | Vouchers redeemable without a subscription | UE DL | ADOPT | yes | NOT_STARTED |  |
| C.11 | Menu and catalogue API | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.11 | Order injection and workflow API | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.11 | Store and site management API | UE DD DL | ADOPT |  | NOT_STARTED |  |
| C.11 | Reporting API | UE DD | ADOPT |  | NOT_STARTED |  |
| C.11 | Webhooks with signature verification and replay handling | UE DD DL | ADOPT |  | DOMAIN | HMAC + Ed25519 verification, dedupe by event id (connectors) |
| C.11 | Picking API for grocery | DL | ADOPT |  | NOT_STARTED |  |
| C.11 | White-label delivery API | UE DD DL | DEFER |  | NOT_STARTED |  |
| C.11 | Middleware bridge to many POS systems | JE (Flyt, 80+ systems) | ADAPT |  | NOT_STARTED |  |
| C.11 | Partner integration certification programme | DD | ADOPT |  | DOMAIN | Connector certification suite (§20.7) |
| C.11 | Sign-in with the platform as an identity provider | DD | DEFER |  | NOT_STARTED |  |
| C.11 | Published API status page and performance standards | DL | ADOPT |  | NOT_STARTED |  |
| C.12 | Conversational ordering assistant in-app | UE DD JE | ADOPT |  | NOT_STARTED |  |
| C.12 | Voice ordering and phone AI | DD JE | ADOPT | yes | NOT_STARTED |  |
| C.12 | Ordering through a messaging app | JE (WhatsApp) | ADOPT and lead |  | NOT_STARTED |  |
| C.12 | AI review summarisation | UE | ADOPT |  | NOT_STARTED |  |
| C.12 | AI menu content, descriptions and translation | UE DD JE | ADOPT |  | NOT_STARTED |  |
| C.12 | AI substitution and replacement suggestions | UE DD | ADOPT |  | NOT_STARTED |  |
| C.12 | AI inventory and demand prediction | UE DD | ADOPT |  | NOT_STARTED |  |
| C.12 | AI campaign, targeting and discount tooling | DD UE | ADOPT |  | NOT_STARTED |  |
| C.12 | AI assistant for merchants | DD UE | ADOPT |  | NOT_STARTED |  |
| C.12 | AI-assisted onboarding | DD | ADOPT |  | NOT_STARTED |  |
| C.12 | Unified behavioural memory across services | DD | ADOPT |  | NOT_STARTED |  |
| C.12 | Agentic commerce connectors for external AI assistants | DD | DEFER |  | NOT_STARTED |  |
| C.13 | Identity verification and continuing background checks | UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.13 | Allergen declaration and warnings before ordering | DL JE | ADOPT |  | PARTIAL | Allergen acknowledgement gate at packing (ordering); no pre-order display |
| C.13 | Food hygiene rating display | DL JE | ADOPT | yes | NOT_STARTED |  |
| C.13 | Product recall handling | DL | ADOPT | yes | NOT_STARTED |  |
| C.13 | Age verification at handover with ID photo proof | UE DD DL JE | ADOPT | yes | NOT_STARTED |  |
| C.13 | Customer self-exclusion from alcohol delivery | DD | ADOPT | yes | NOT_STARTED |  |
| C.13 | Fraud detection on accounts, promotions and payments | SF UE DD DL JE | ADOPT |  | NOT_STARTED |  |
| C.13 | Account sharing detection | UE | ADOPT |  | NOT_STARTED |  |
| C.13 | Dispute resolution with evidence | UE DD DL JE | ADOPT and extend |  | PARTIAL | Automatic evidence bundle (ordering/evidence.ts); no dispute flow |
| C.13 | Published ranking transparency | JE | ADOPT |  | NOT_STARTED |  |
| C.13 | Algorithmic transparency disclosures to couriers | DL JE | ADOPT | yes | NOT_STARTED |  |
| C.13 | Independent dispute body for couriers | DL (CEDR) | DEFER | yes | NOT_STARTED |  |
| C.13 | Fee transparency overhaul | DD | ADOPT from the start |  | DOMAIN | Named price lines and all-in display (pricing) |
| C.13 | Data portability and export | JE DL | ADOPT |  | NOT_STARTED |  |

## Deliberately rejected (C.15)

| Rejected | Reason |
| --- | --- |
| Merchant commission | The customer service charge funds the platform instead; this is the commercial wedge (§18.1) |
| Deleting reviews that mention delivery | Attribute the complaint to the rider instead; deleting it hides a real failure |
| Public per-rider star ratings | Fairness and labour-status risk outweigh the marginal customer benefit |
| Acceptance rate as a performance metric | Unfair, and evidence of control that weighs against self-employed status |
| Dark stores and owned inventory | Asset-heavy, contrary to the zero-footprint operating model |
| Autonomous delivery | No relevance to the launch markets for the foreseeable future |
| AI-generated food imagery | Misleads customers about what they will receive |
| Obscure admin URLs as a security measure | Replaced by scoped identity, MFA and device binding |
| One installation or one currency per country | Replaced by a single multi-market, multi-currency platform (§7, §19) |
