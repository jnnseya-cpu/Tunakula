# Restaurant / Merchant-Facing Feature Set: StackFood, DoorDash, Uber Eats, Deliveroo, Just Eat

> Scope note: This is a build backlog — a dense inventory of concrete merchant-facing features across the web panels and tablet apps of five platforms, current to 2026. StackFood (the Laravel/Flutter CodeCanyon platform, restaurant_panel web + store_app Flutter) is the primary benchmark; its features are called out explicitly. Platform coverage is noted per feature. Many StackFood specifics below are drawn from knowledge of the v8.x codebase/demo and are marked as **Inferences** where not directly cited, because 6amtech.com, preview.6amtech.com, and the docs/reseller mirrors were blocked by the network egress proxy during research (only search-result summaries were retrievable).

## Onboarding & Account (signup, verification, payout setup, store profile, multi-branch, staff/roles)

### Takeaway
All four commercial platforms support self-service or guided signup, business/tax verification, bank/payout setup, store-profile editing, multi-location switching, and tiered staff roles. StackFood supports vendor self-registration, admin approval, store profile, bank-info for withdrawals, multi-branch ("sub-stores"), and an employee/role module, but it is self-hosted so verification is admin-driven rather than automated KYC.

### Cited Findings
- **Uber Eats** signup is 4 steps: complete signup form → tell us about your business → add menu/catalog → turn on Uber Eats Orders app and accept orders — [Uber Eats merchant signup](https://www.ubereats.com/restaurant/en-US/onboarding/contract)
- **Uber Eats** multi-location: in Uber Eats Manager go to **Stores → Add** (top right) to add stores under an existing brand or a new brand; new stores get dashboard onboarding prompts to complete essentials — [Uber Eats Manager learning center](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)
- **Uber Eats** roles are 3 tiers: **Staff** (base) → **Manager** (adds feedback auto-replies, invoices/payments/tax info, user access, marketing tools) → **Admin** (adds bank-info changes, ownership transfer). Only Admin/Manager can add/remove users; new users inherit the same permissions by default and must be adjusted. Add via **Users → Add user** (name + email; invitee emailed access) — [Uber Eats Manager learning center](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/); [Uber training guide PDF](https://tb-static.uber.com/prod/udam-assets/5f8c9934-5c4f-59f9-91a6-b547901af8c4.pdf)
- **DoorDash** multi-location: changes apply to one or all locations; cross-location changes require a shared menu and Manager/Admin access; Business Manager app switches between stores, businesses, and group IDs — [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/orders-and-store-management)
- **StackFood** supports two business models selectable per restaurant: **Commission-based** and **Subscription-based**; admin defines order and subscription commission rates; restaurants can digitally pay subscription fees to admin — [6amtech StackFood product page (via search)](https://preview.6amtech.com/page/stack-food-multi-restaurant-food-delivery-app-with-laravel-admin-and-restaurant-panel)
- **StackFood** has Zone-based coverage drawn on a map, multilingual support, Marketing/Employee/Accounts sections, and SMS OTP — [6amtech StackFood listing (via search)](https://6amtech.com/?p=25418)

### Inferences
- **StackFood restaurant_panel** (self-hosted) typically exposes: vendor **self-registration/signup** (store + owner details, logo/cover upload, zone selection, lat/long pin), **admin approval** gate before going live, **store profile** (name, address, phone, logo, cover, cuisine, min order, tax %, comission settings view), **bank information** page (holder name, bank name, branch, account no., routing) used for withdrawals, and a per-vendor **GST/VAT/tax** field. Verification is admin-manual (no automated KYC), unlike DoorDash/Uber/Just Eat.
- **StackFood multi-branch**: the platform supports multiple restaurants per owner account in later versions; staff switch between stores. Each branch has its own menu/hours.
- **StackFood employee/role module**: the restaurant panel has an **Employee Role** (create custom roles with module-level permissions: order, food/menu, POS, campaign, reports, etc.) and **Employee** (add staff with name/email/phone/role) — mirrors the admin panel's role system.
- DoorDash onboarding is via get.doordash.com self-signup with menu build and tablet provisioning; Just Eat via business.just-eat.co.uk vendor signup form; Deliveroo via restaurants.deliveroo.com signup — all include business verification (tax ID, food-hygiene rating for Just Eat UK) and bank/payout setup during onboarding.

### Gaps
- Exact StackFood registration field list and whether vendor self-signup is enabled by default vs. admin-created — could not confirm (6amtech blocked).
- DoorDash/Deliveroo/Just Eat precise role-permission matrices beyond Uber's 3-tier model not confirmed from primary sources this pass.

## Order Management (live board, accept/reject, prep time, ready/picked-up, notifications, auto-accept, history, printing/KDS, courier handover)

### Takeaway
All platforms provide a live incoming-order board on a tablet/app with accept/reject, prep-time setting, status progression, sound alerts, order history/detail, and printing. StackFood's store_app provides active-order lists by status, accept/confirm, and continuous alert sounds (a known pain point), plus order re-assignment and multiple order-confirmation models.

### Cited Findings
- **DoorDash Order Manager** (tablet app, rent from DoorDash or own Android device) receives, organizes, and tracks delivery + pickup orders, marks items out of stock, and updates store hours; **Business Manager** (phone) handles orders in real time, resolves issues, reads/answers feedback, notifications; stores can be paused during busy periods; 24/7 support — [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/orders-and-store-management)
- **Just Eat Orderpad** is the tablet app for receiving orders; you set days/times to take orders in Partner Hub; you can lengthen prep by adding minutes to Collection and Delivery times per day of week; self-delivery orders that can't be fulfilled are cancelled via the Orderpad — [Just Eat how to manage your orders](https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders)
- **Deliveroo tablet** (sold with printer) shows order details, tracks rider status, and shows pick-up times; restaurants can instead use their own laptop/tablet connected to their own printer + Partner Hub; device connects to POS — [Deliveroo technology](https://restaurants.deliveroo.com/en-hk/technology)
- **StackFood** restaurant app features: Earning Summary, **status-wise Active Order List**, Filter option, Add New Food, Restaurant Settings, Add Category/Sub-category — [StackFood listing (via search)](https://6amtech.com/?p=25418)
- **StackFood v7.2** added for restaurant owners: **Order re-assignment** (to a different deliveryman, if Self-Delivery enabled), cash-in-hand overflow handling, **Custom Message on Display**, and digital payment of dues — [6amtech StackFood (via search)](https://6amtech.com/?p=25418)
- **StackFood order-confirmation models**: **Restaurant-first** (restaurant accepts, prepares, then calls deliveryman — default) and **Deliveryman-first** (deliveryman accepts first); admin can enable/disable **Instant Order** per restaurant — [StackFood order confirmation models](https://6amtech.com/blog/stackfoods-order-confirmation-models/)
- **StackFood notifications**: two modes — **Firebase** (standard pop-up, no continuous ringing) and **Manual** (continuous alert every 10s until order viewed); background notifications must be enabled separately; buyers report background/foreground sound bugs and sometimes needing to refresh to see new orders — [CodeCanyon comments](https://codecanyon.net/comments/31708940)

### Inferences
- **StackFood store_app** order flow: tabs for **All / Pending / Accepted / Confirmed / Processing / Handover / Picked Up / Delivered / Canceled / Refunded**; order detail shows items, add-ons, customer note, delivery address/map, payment method; **Accept** / **Reject** (with reason) buttons; set/adjust **preparation time**; **Mark ready / handover to courier**; **Order history** with date filter and search. POS screen in panel for walk-in/dine-in orders.
- All commercial platforms support **auto-accept** of orders (DoorDash, Uber Eats, Deliveroo, Just Eat all offer auto-confirm for integrated/tablet flows); explicit accept/reject with reason codes; KDS (kitchen display) via POS integrations rather than native in most.
- Courier handover: StackFood marks "handover"; DoorDash/Uber/Deliveroo/Just Eat (platform delivery) show assigned-driver status and ETA on the order card.

### Gaps
- Native KDS: none of the five appear to ship a first-party kitchen-display beyond tablet order lists; KDS is via POS partners — not confirmed per platform.
- Exact DoorDash/Uber reject-reason taxonomies not captured.

## Menu Management (categories, items, variations, add-ons/modifiers, photos, per-language, pricing, tags, availability/86ing, scheduling, bulk import, approval)

### Takeaway
All platforms offer web menu editors with categories/items/modifiers, photos, pricing, out-of-stock toggles, and dayparting/scheduling; DoorDash, Uber, Deliveroo, Just Eat sync from POS. StackFood's panel covers categories/sub-categories, food items with variations and add-ons, veg/non-veg, nutrition and allergy fields, and per-language names, but menu scheduling is customer-order oriented.

### Cited Findings
- **DoorDash Menu Editor** (web, in Menus tab): edit menu, add-ons/modifiers for customization, mark items out of stock temporarily, update photos/descriptions from any device; **Daypart menus** show different menus by time of day / day of week; POS-integrated menu changes sync automatically; menu edits also available in Business Manager and Order Manager apps (Order Manager also updates store hours) — [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/orders-and-store-management)
- **Deliveroo Menu Manager** (Partner Hub web): view/edit all menus, edit items & photos, add new categories, publish a menu across multiple sites, duplicate/delete/rename menus (delete only if unassigned to a site); without Menu Manager access you request changes via Help form (up to 3 days); POS-connected menu updates stock in real time; Deliverect-type integrations push menu changes live in ~5 min — [Deliveroo managing your menu in Partner Hub](https://help.deliveroo.com/en/articles/3524899-managing-your-deliveroo-menu-in-partner-hub)
- **Just Eat** menu: add new items anytime with descriptions and images, keep categories current, flag sold-out/out-of-stock items; short-term shortage — take item offline until end of day (auto-returns next day; redo if still out); change prices / adjust categories; changes go live on customer app almost instantly — [Just Eat how to manage your orders](https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders); [Just Eat Partner Hub listing](https://foxdata.com/jp/app-marketing-analytics/1039863376/as/GB/just-eat-takeaway-partner-hub/)
- **Uber Eats Manager** has a **Menu tab** for editing; Marketing-role users can also update the menu — [Uber Eats Manager learning center](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)
- **StackFood** restaurant app: Add New Food, Add Category and Sub-category — [StackFood listing (via search)](https://6amtech.com/?p=25418)

### Inferences
- **StackFood food management** (panel + app): **Category** and **Sub-category** CRUD; **Food item** with name, description, image, **price**, **discount** (flat/percent), **variations** (e.g., size options with required min/max select counts), **add-ons** (attachable extras with price), **veg/non-veg** flag, **nutrition** text, **allergen/allergy** ingredients field, **maximum order quantity**, and availability time window per item (available-from/to). **Per-language** name/description via the platform's multilingual translation table. **Availability toggle** (active/inactive) and **recommended** flag. No native bulk CSV import/export in base product in some versions (admin-side import may exist). No menu-approval workflow (self-hosted, instant publish).
- DoorDash/Uber/Just Eat/Deliveroo all support **modifier groups** (required/optional, min/max), **item photos**, **descriptions**, **dietary/allergen tags**, and **86ing/sold-out** toggles with auto-reactivation options; bulk import via POS/menu-management partners.
- **Menu approval workflow** exists on Uber Eats and Deliveroo (changes reviewed/validated before going live in some regions); DoorDash and Just Eat publish near-instantly; StackFood publishes instantly.

### Gaps
- StackFood native bulk import/export and halal tag presence not confirmed from primary source (blocked).
- Per-platform allergen/nutrition tag taxonomies (14 EU allergens for Just Eat/Deliveroo UK) not individually cited this pass.

## Store Operations (hours, special/holiday hours, temp close/pause/busy mode, prep extension, delivery radius/zones, throttling)

### Takeaway
All platforms let merchants set opening hours, pause/close the store temporarily (busy mode), and extend prep times; Just Eat and StackFood set hours per day; zone/radius is admin-controlled in StackFood and platform-controlled elsewhere.

### Cited Findings
- **DoorDash** stores can be paused during busy periods; Order Manager updates store hours — [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/orders-and-store-management)
- **Just Eat**: set days/times to take orders in Partner Hub; add minutes to Collection and Delivery prep times per day of week when busy; set delivery area in Partner Hub — [Just Eat how to manage your orders](https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders)
- **StackFood** has **zone-based coverage drawn on a map**; a vendor asked about disabling orders for one zone and was told there is no option to disable orders for a specific zone — [StackFood listing (via search)](https://6amtech.com/?p=25418); [CodeCanyon comments](https://codecanyon.net/comments/31708940)
- **Deliveroo** Partner Hub manages business "anywhere, on any device" incl. hours/availability (availability is a Reports/Hub area) — [Deliveroo reports in Hub](https://help.deliveroo.com/en/articles/6463245-how-to-view-and-use-reports-in-hub-excluding-signature-partners)

### Inferences
- **StackFood** restaurant settings include **open/close schedule** (per-day time slots), a **temporary close / "closed" toggle** (store on/off), **delivery time estimate**, **minimum order amount**, and **scheduled delivery** support. Busy-mode/prep-extension is more limited than commercial peers. Delivery radius/zone is set by the admin (zone polygons), not the vendor.
- **Order throttling** (limit orders per time window / "busy mode") is native on DoorDash, Uber Eats (Busy mode / pause), Deliveroo (busy mode), Just Eat (prep-time extension). StackFood lacks granular throttling.
- **Special/holiday hours**: DoorDash, Uber Eats, Deliveroo, Just Eat all support special-hours/holiday overrides; StackFood relies on manual temporary close.

### Gaps
- StackFood special-holiday-hours feature presence unconfirmed.

## Promotions & Marketing (coupons/discounts, happy hour, BOGO, sponsored/ads, loyalty, featured placement, campaigns)

### Takeaway
Commercial platforms have rich self-serve promotion + paid-ads + loyalty suites (DoorDash Promotions/Sponsored Listings; Uber ads/offers; Deliveroo Marketer offers; Just Eat StampCards/TopRank/Promoted Placement). StackFood offers coupons, campaigns/discounts, and a built-in promotion/banner capability, mostly admin-driven.

### Cited Findings
- **DoorDash Promotions**: feature business in the Offers tab; offer customer discounts, $0 delivery fee, or free/discounted item; cost per order = delivery cost or discount + DoorDash marketing fee; commission on subtotal after discounts; $100 promo credit offer for eligible stores — [DoorDash Promotions](https://merchants.doordash.com/en-us/products/promotions)
- **DoorDash Sponsored Listings** (self-serve ads): move up on homepage/search; **pay per order** not per click/impression; claimed 4.1x average ROAS; **Storefront** promotions drive commission-free direct orders — [DoorDash Promotions](https://merchants.doordash.com/en-us/products/promotions); [DoorDash ads launch](https://about.doordash.com/en-au/news/doordash-launches-new-ad-solution-levelling-the-playing-field-for-merchants-of-all-sizes)
- **Uber Eats** marketing tools: **ads and offers** to drive orders, launched from the Manager app (Marketing-role gated) — [Uber Eats Manager learning center](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)
- **Deliveroo Marketer** offers: create offers, then Hub shows an offer-performance report (orders, gross revenue, discount spend, net revenue, new/returning customers, avg rating) — [Deliveroo offer performance](https://help.deliveroo.com/en/articles/6589645-understanding-offer-performance)
- **Just Eat StampCards** (loyalty): customer gets a stamp per order; on 6th order a discount equal to 10% of past 5 orders — [Just Eat Partner Hub listing](https://foxdata.com/jp/app-marketing-analytics/1039863376/as/GB/just-eat-takeaway-partner-hub/)
- **Just Eat TopRank** and **Promoted Placement**: Promoted Placement = advertising to place restaurant in top-5/"Promoted" search positions; eligibility Food Hygiene 3+ and Customer Experience Score 25+; **cost-per-click** with weekly budget; ~20% more orders claimed; campaign performance viewable in Partner Hub + monthly email — [Just Eat Promoted Placement FAQ](https://partner.just-eat.co.uk/blog/marketing-promotion/promoted-placement-faq); [Just Eat Partner Hub listing](https://foxdata.com/jp/app-marketing-analytics/1039863376/as/GB/just-eat-takeaway-partner-hub/)
- **StackFood**: built-in **campaigns & discounts for sales promotion** — [StackFood product page (via search)](https://preview.6amtech.com/page/stack-food-multi-restaurant-food-delivery-app-with-laravel-admin-and-restaurant-panel)

### Inferences
- **StackFood** marketing/promotion features: **Coupons** (code, type flat/percent, min purchase, discount cap, limit per user, start/end date, applicable restaurant/customer), **Campaigns** (basic campaign + item campaign with join/leave by restaurant), **Banners/Advertisement** (promotional banner requests submitted by restaurant for admin approval — newer v8 "Advertisement" module lets a restaurant request a paid featured/video ad), and **push notification** sends. Loyalty is customer-side (loyalty points/wallet) rather than merchant-configurable BOGO/happy-hour. No native BOGO/happy-hour builder like DoorDash.

### Gaps
- Uber Eats loyalty program specifics and StackFood's exact promotion-builder fields not confirmed from primary sources.

## Pricing & Financials (menu vs delivery pricing, commission/plan visibility, payouts/settlements, invoices, earnings, wallet/withdrawals, tax docs, disputes)

### Takeaway
Commercial platforms expose commission/plan, payout schedules, invoices, tax docs, and earnings in-portal; StackFood exposes commission vs. subscription, a wallet with withdrawal requests (requiring bank info re-entry — a reported pain point), earnings summary, and digital dues payment.

### Cited Findings
- **StackFood** earnings: restaurant app **Earning Summary**; **wallet/withdrawals** exist but a buyer reports owners must re-enter bank details on every withdrawal; a **new payment disbursement system/UI** was introduced; restaurants can digitally pay subscription/dues to admin; offline-payment flow where admin verifies customer payment before restaurant confirms order — [CodeCanyon comments](https://codecanyon.net/comments/31708940); [6amtech payment disbursement blog](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)
- **StackFood** cash-in-hand overflow feature + digital payment of dues (v7.2) — [StackFood listing (via search)](https://6amtech.com/?p=25418)
- **DoorDash**: merchant portal offers analytics and financial access (archived page) — [DoorDash merchant (archived)](https://web-archive.nli.org.il/National_Library/oe_/https://get.doordash.com/en-us)
- **Uber Eats Reports**: download detailed reports on payments, operations, and feedback; Manager/Admin roles view/edit invoices, payments and tax information — [Uber Eats Manager learning center](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)
- **DoorDash** tablet rental fees: $6/wk US, $3/wk Canada, $0 AU/NZ (rates may change) — [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/orders-and-store-management)

### Inferences
- **StackFood** financials: **commission vs subscription** model visibility per store; **wallet balance**, **collected cash / cash-in-hand** vs. **owed to/from admin** reconciliation, **withdraw request** list, **transaction history**, and **disbursement** records. Tax is a per-store % applied to orders. No formal invoice/tax-document generation like Uber/Just Eat issue to partners.
- DoorDash/Uber/Deliveroo/Just Eat provide **weekly payout/settlement statements**, downloadable **invoices**, **tax documents** (e.g., 1099-K US; VAT invoices UK/EU), and **adjustment/dispute** flows for error charges and refunds within the portal.

### Gaps
- DoorDash/Deliveroo payout schedules and dispute-handling screens not confirmed from primary sources this pass.

## Analytics & Reporting (sales, order stats, item performance, customer insights, ratings analytics, ops metrics, downtime, financial statements, exports)

### Takeaway
All commercial platforms have analytics dashboards with sales, operations, feedback, and customer-group insights, exportable; StackFood provides sales/order/earnings reports and statistics in the panel.

### Cited Findings
- **Uber Eats** analytics/performance: **Sales** (revenue/sales by channel), **Operations** (inaccurate orders, refunds, chargebacks with issue-type breakdown + heatmap of when problems occur), **Top Eats** badge progress, **Customer groups** (new/returning/lapsed), **Feedback** (food & shop feedback, read/respond to reviews) — [Uber Eats Manager learning center](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)
- **Deliveroo Hub Reports** areas: Performance (sales/orders/ratings snapshot), Availability, Customers (incl. promo performance), Speed, Orders, Items sold; new Hub homepage has ratings & reviews section, period-over-period comparison, ratings trend, and actionable recommendations — [Deliveroo reports in Hub](https://help.deliveroo.com/en/articles/6463245-how-to-view-and-use-reports-in-hub-excluding-signature-partners); [Deliveroo new Hub homepage](https://help.deliveroo.com/en/articles/9515129-how-to-use-the-new-hub-homepage)
- **Just Eat** Analytics: revenue, number of orders, hourly insights; **Performance Score** with personalized recommendations — [Just Eat Partner Hub listing](https://foxdata.com/jp/app-marketing-analytics/1039863376/as/GB/just-eat-takeaway-partner-hub/)
- **StackFood** includes Reporting and Statistics — [StackFood listing (via search)](https://6amtech.com/?p=25418)

### Inferences
- **StackFood reports** (panel): **sales report** (by date range), **order report** (by status/payment), **earning/transaction report**, **expense**, and **most/least sold items**; exportable to Excel/CSV in admin, partial in vendor panel. Customer-insight and ratings-analytics depth is below commercial peers. No native acceptance-rate/downtime scorecard like Uber Top Eats / Just Eat Performance Score / Deliveroo recommendations.
- Ops metrics (acceptance rate, prep time, cancellation rate, offline/downtime) are first-class on Uber (Top Eats), Deliveroo (Hub recommendations), Just Eat (Performance Score, Local Legend), DoorDash (operations quality).

### Gaps
- StackFood vendor-panel export formats and exact report list not confirmed (blocked source).

## Customer Interaction (reviews/replies, chat/messaging, refunds/adjustments, cancellations, missing items)

### Takeaway
All commercial platforms let merchants read/reply to reviews, handle refunds/adjustments and cancellations, and manage missing-item disputes; DoorDash and Uber emphasize feedback response and chargeback visibility. StackFood surfaces ratings/reviews and refund/cancel handling, with customer chat in later versions.

### Cited Findings
- **DoorDash** Business Manager: respond to customer feedback, resolve issues, reach support, read/answer customer feedback; merchant portal has tools to respond to reviews and customer insights incl. delivery zip codes — [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/orders-and-store-management); [DoorDash merchant (archived)](https://web-archive.nli.org.il/National_Library/oe_/https://get.doordash.com/en-us)
- **Uber Eats** Feedback: read and respond to customer reviews; auto-replies to feedback configurable (Manager role); Operations shows amount charged back due to inaccurate orders — [Uber Eats Manager learning center](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)
- **Deliveroo** Hub homepage ratings & reviews section with trends — [Deliveroo new Hub homepage](https://help.deliveroo.com/en/articles/9515129-how-to-use-the-new-hub-homepage)
- **Just Eat** self-delivery can't-fulfil orders cancelled via Orderpad — [Just Eat how to manage your orders](https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders)

### Inferences
- **StackFood**: restaurant panel shows **ratings & reviews** per food item and store (read-only in base, reply in later versions), **refund request** handling (approve/reject refund, refund reason), **order cancellation** with reason, and customer **chat/messaging** (conversation module) in v8.x. Missing-item/adjustment handling is manual via refund/cancel.
- Refund/adjustment, cancellation-reason codes, and missing-item credit flows are standardized in DoorDash/Uber/Deliveroo/Just Eat portals.

### Gaps
- Review-reply availability per StackFood version, and DoorDash/Deliveroo/Just Eat missing-item dispute UI specifics, not confirmed.

## Integrations, Devices, Delivery Options (POS, 3rd-party, printers, tablet apps, device mgmt; self vs platform delivery, pickup, dine-in/QR, virtual brands)

### Takeaway
All commercial platforms integrate POS and middleware (Deliverect/Otter/UrbanPiper), ship/rent a tablet+printer, and support self-delivery vs platform delivery, pickup, and virtual brands. StackFood ships a built-in POS, self-delivery toggle, pickup/takeaway, and dine-in; tablet printing via the store app.

### Cited Findings
- **StackFood** has a **built-in free POS** for managing orders — [StackFood product page (via search)](https://preview.6amtech.com/page/stack-food-multi-restaurant-food-delivery-app-with-laravel-admin-and-restaurant-panel)
- **StackFood Self-Delivery**: admin enables per restaurant; if on, restaurant bears delivery cost and sees order re-assign; if off, admin bears delivery cost and feature hidden — [StackFood self-delivery (via search)](https://6amtech.com/blog/stackfoods-order-confirmation-models/)
- **DoorDash** Order Manager runs on rented/own Android tablet; POS-integrated menu changes sync automatically; Storefront = merchant's own-website ordering — [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/orders-and-store-management)
- **Deliveroo** tablet sold with printer; own-device option connects to own printer + Partner Hub; connects to POS; Deliverect-type middleware pushes menus — [Deliveroo technology](https://restaurants.deliveroo.com/en-hk/technology); [Deliverect Deliveroo integration](https://help.deliverect.com/en/articles/7979326-deliveroo-integration-overview)
- **Uber Eats**: set up a **webshop for direct orders**; manage shop info/hours; run ads — [Uber Eats Manager learning center](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)
- **Just Eat Orderpad** tablet app; UrbanPiper-type integration streamlines menu + order management — [Just Eat how to manage your orders](https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders); [UrbanPiper Just Eat](https://urbanpiper.com/blog/just-eat-signup-restaurants)

### Inferences
- **StackFood** supports **platform delivery** (admin's delivery men, manual/auto assignment & dispatch management) vs **self-delivery** (restaurant's own riders); **pickup/takeaway**; **dine-in** via POS; later v8 versions add **QR / table-side** ordering and **multiple menus/virtual brand**-style constructs are limited. Printing is via the store app / connected printer (POS receipt). No native third-party POS marketplace — it IS the POS.
- DoorDash/Uber/Deliveroo/Just Eat all support **virtual brands/multiple storefronts**, **pickup**, and dine-in/QR (Uber, DoorDash) to varying degrees; device management (tablet provisioning, replacement) handled in-portal or via support.

### Gaps
- StackFood QR/dine-in and virtual-brand capabilities by version, and printer-hardware support list, not confirmed from primary sources (6amtech blocked).

## Research method & source-quality notes
- **Blocked sources**: 6amtech.com, preview.6amtech.com, dknullzone.run.place, merchants.doordash.com, partner.just-eat.co.uk were all blocked by the network egress proxy (EGRESS_BLOCKED); only WebSearch summaries of these were available, so several StackFood specifics are marked **Inferences** from codebase/demo knowledge rather than direct citations.
- CodeCanyon buyer comments are used for StackFood bug/pain-point signal (notification sound, withdrawal bank re-entry, no per-zone order disable) — these are user reports, not vendor specs.
- Deliveroo "Signature partners" see different reports; Just Eat Promoted Placement mechanics differ across Just Eat's own pages (top-5 vs. favored "Promoted" slots). DoorDash tablet fees are region-specific and may change.
