# Admin / Platform-Operator (Back-Office) Feature Set — StackFood + DoorDash/Uber Eats/Deliveroo/Just Eat

> **Research constraint (read first):** All primary StackFood sources — `docs.6amtech.com`, `preview.6amtech.com` (live demo), `zoftwarehub.com`, and the CodeCanyon mirrors — are **egress-blocked** by the proxy in this environment, so they could not be fetched directly. WebSearch returned reliable *summaries* of these pages and confirmed the major module names and menu paths cited below. The full, screen-by-screen admin module tree (the "~150 screens") is enumerated from the author's knowledge of the StackFood / 6amtech Laravel admin codebase (StackFood, eFood, 6amMart, GroFresh, Six Valley all share one admin shell). **Confirmed-by-source items are under "Cited Findings"; the exhaustive screen/menu enumeration that could not be individually sourced is under "Inferences" and should be treated as a high-confidence but source-unverified build backlog.** No StackFood GitHub mirror was found; it is a commercial CodeCanyon product ($69, PHP/Laravel 10 + Flutter), apps sold separately or as a combo — [CodeCanyon](https://codecanyon.net/comments/31749539), [6amtech docs summary](https://docs.6amtech.com/docs-stack-food/intro).

---

## Q1. Dashboard — KPIs, charts, order stats, earning stats, by-role widgets, recent orders, top lists

### Takeaway
StackFood admin opens on a single analytics dashboard combining order-status counters, earning/commission stats, time-series charts, and "top" leaderboards; the exact tile set is standard across 6amtech products but could not be screenshot-verified due to blocked sources.

### Cited Findings
- 6amtech admin panels surface a headline order graph tracking orders through assigned, accepted, picked up, out-for-delivery, delivered, and failed stages, plus counters like "Active Orders," "Delivered Today," "Failed Today" (described for a comparable food-delivery admin) — [Webkul food-delivery guide](https://webkul.com/blog/nodejs-food-delivery-user-guide/).
- Listings consistently name "Reporting and Statistics" as a core admin area of StackFood — [ctit mirror of v7.6 listing](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html).

### Inferences (StackFood admin dashboard screen, high confidence)
- **Business Analytics / status cards:** Pending, Confirmed, Packaging/Processing, Out for Delivery, Delivered, Canceled, Refunded, Scheduled, Payment Failed — each a clickable counter linking to the filtered order list.
- **Earning statistics chart** (toggle: this week / this month / this year / overall; commission earned, total earning, line/bar chart by day/month).
- **Order statistics chart** (total orders over time).
- **Zone-wise order filter** on the dashboard (select zone to scope all widgets).
- **Commission overview**: admin commission, delivery charge earned by admin, total tax collected.
- **Wallet/transaction summary widgets**: total wallet balance of customers, pending disbursements.
- **User overview counts**: total customers, total restaurants, total delivery men, total foods.
- **Top-sellers leaderboards**: Top Selling Foods, Top Rated Foods, Top Restaurants, Top Customers (most orders).
- **Most/Popular restaurants**, **Recent orders** table (last N with status), **Order request list**.
- Role-scoped dashboards: an employee with limited role sees only widgets their permissions allow.

### Gaps
- Could not verify the exact count or labels of dashboard tiles for v8+ from a primary screenshot (sources blocked).

---

## Q2. Order Management — statuses, detail, assign/reassign, edit, refunds

### Takeaway
StackFood has an "Advanced Order Management" module with a left-nav list of orders segmented by every lifecycle status, a rich order-detail screen, and admin actions for status change, deliveryman assignment/re-assignment, and refunds; several of these (re-assign, refund flow, scheduled orders) are confirmed in release notes.

### Cited Findings
- **Order Re-assign** (reassigning a delivery man to an order) is an admin feature added in v7.2 — [6amtech v7.2 notes summary](https://6amtech.com/?p=25418).
- **Refund** handling is part of the admin order workflow; refund settings are an admin-configurable area (see Q11) — [v7.2 notes](https://6amtech.com/?p=25418).
- **Scheduled delivery / scheduled orders** are supported (restaurant-config and order type) — [zone/docs summary](https://docs.6amtech.com/docs-stack-food/intro).
- **Manual delivery-man assignment / Dispatch Management** is a named admin feature — [ctit v7.6 listing](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html).
- **Delivery verification**: when enabled, deliverymen upload a delivered photo visible to admin/restaurant/deliveryman/customer — [v7.1 notes summary](https://6amtech.com/blog/stackfood-v7-1/).
- Comparable systems model a refund/failed state distinctly from a payment-failure state in the order status lifecycle — [storekit order statuses](https://storekit.com/docs/guides/orders/order-statuses).

### Inferences (StackFood Order Management sub-menu, high confidence)
- **Order list filtered views (one screen each):** All Orders, Pending, Confirmed/Accepted, Processing/Packaging, Food on the Way / Out for Delivery, Delivered, Canceled, Payment Failed, Refund Requested, Refunded, Scheduled, Dine-in, Offline-payment (pending verification).
- **Filters on each list:** by zone, by restaurant, by date range, by order type (delivery/takeaway/dine-in/subscription), search by order ID/customer; **export** list to Excel/CSV.
- **Order detail screen:** customer info + map location, item list with add-ons/variations, subtotal/discount/coupon/tax/delivery-fee/total breakdown, payment method & status, order type, restaurant, assigned deliveryman; **actions**: change status dropdown, assign/reassign delivery man, print invoice, download invoice, collect cash flag, add order note, refund/approve-refund, view delivered proof photo.
- **Offline payment verification** screen (approve/deny customer-submitted payment info).
- **Order cancellation** with reason selection (reasons managed in settings, see Q11).
- **Edit order** (adjust items/quantities before processing) — limited; present in later versions.

### Gaps
- Whether admins can fully edit line items of an in-flight order (vs. only cancel/refund) varies by version and was not source-confirmed.

---

## Q3. Restaurant / Store Management

### Takeaway
A full restaurant CRUD + approval + configuration module: list, add, edit, approve join requests, per-restaurant commission/tax/min-order/delivery config, restaurant wallet & disbursement, reviews, recommended flag, and bulk import/export — most of these are source-confirmed.

### Cited Findings
- **Bulk import/export of restaurants** (and foods, addons, categories/subcategories) is an admin feature — [v7.1 notes summary](https://6amtech.com/blog/stackfood-v7-1/).
- **Restaurant approval / self-registration with custom fields**: admins can configure a custom-field option for restaurant self-registration (join requests) — [v7.2 notes summary](https://6amtech.com/?p=25418).
- **Disbursement to restaurants**: admin pays restaurants via a Disbursement feature at *Admin Panel > Business Settings > Disbursement*; restaurants can also settle dues via their wallet (*Restaurant Panel > Business Management > My Wallet*) — [v7.2 notes summary](https://6amtech.com/?p=25418).
- A newer **payment disbursement system + UI** was shipped (react website + disbursement redesign) — [6amtech disbursement post](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/).
- **Role-based access for restaurant owners**; restaurants operate via a separate web panel and a native restaurant app — [docs summary](https://docs.6amtech.com/docs-stack-food/intro).
- **Free Delivery Setup** per restaurant/admin is configurable (v7.2) — [v7.2 notes](https://6amtech.com/?p=25418).
- Known limitation: a restaurant cannot be set to operate in multiple zones, and multi-branch under one owner was a pending feature request — [CodeCanyon comment summary](https://codecanyon.net/comments/31727302).

### Inferences (Restaurant Management sub-menu)
- **Restaurants list** (search/filter by zone, status active/inactive, featured/recommended), **Add new restaurant** (owner account, logo/cover, zone, address on map, tax/VAT, min order, delivery options, schedule), **Edit restaurant**.
- **Restaurant join requests** (approve/deny pending registrations).
- **Restaurant settings per store:** commission % (admin or self), scheduled delivery on/off, home delivery / takeaway toggles, GST/VAT, minimum order amount, free delivery over X, delivery time, extra packaging charge, cutlery option, POS on/off, instant/scheduled order.
- **Restaurant wallet** (balance, collected cash, withholding, pending/already-withdrawn), **Restaurant disbursement** list & disbursement report.
- **Restaurant reviews** list (view/delete, by rating).
- **Recommended restaurants** toggle/list; **Featured** flag.
- **Bulk import** (upload Excel) / **Bulk export** of restaurants.
- **Add vendor/employee under restaurant** (restaurant-side roles, visible to admin).

### Gaps
- Per-restaurant setting labels for v8+ not screenshot-confirmed.

---

## Q4. Food / Item Management

### Takeaway
Item catalog module spanning categories/sub-categories, cuisines, the foods list with add/edit (attributes, variations, add-ons, nutrition, allergies), bulk import/export, and food reviews — bulk tooling and per-item purchase caps are source-confirmed.

### Cited Findings
- **Bulk import/export of food items, addons, and categories/subcategories** — [v7.1 notes summary](https://6amtech.com/blog/stackfood-v7-1/).
- **Per-food maximum purchase quantity** cap per checkout, set at *Admin Panel > Food Management > Foods > Add New* — [v7.1 notes summary](https://6amtech.com/blog/stackfood-v7-1/). (Confirms the "Food Management > Foods" menu path.)

### Inferences (Food Management sub-menu)
- **Categories** (parent) and **Sub-categories** list/add/edit, with image, priority/position, status.
- **Cuisines** list/add/edit (assigned to restaurants and foods).
- **Attributes** (e.g., size) list/add/edit; **Add-ons** list/add/edit (per restaurant).
- **Foods** list (filter by restaurant/category/zone; search), **Add new food** (name, description, image, category/sub-category, price, discount, variations/attributes, add-ons, tax/VAT, nutrition, allergen info, available time range, veg/non-veg, max purchase qty, stock), **Edit food**.
- **Food reviews** list (view/delete).
- **Bulk import / Bulk export** of foods and add-ons.
- **Recommended / featured foods** flag.

### Gaps
- Whether "Unit" management and "Nutrition/Allergy" fields exist in every version (they do in sibling 6amMart) was not food-specific confirmed for StackFood v8.

---

## Q5. Zone & Geography / Modules

### Takeaway
Zones are the foundational entity: polygon-on-map zones toggle business on/off and carry per-zone delivery-fee and extra-charge config; module management (food vs. other verticals) exists in the multi-vertical siblings but StackFood is food-only.

### Cited Findings
- "The whole system depends on operation zone"; admin can **create multiple zones** and **turn business on/off per zone** — [docs summary](https://docs.6amtech.com/docs-stack-food/intro).
- Zone boundary is drawn as an accurate **coverage area polygon on a map** — [ctit v7.6 listing](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html); marketing describes "location-wise multiple business zones" — [docs summary](https://docs.6amtech.com/docs-stack-food/intro).
- **Extra charges / service or platform fee** are admin-configurable under *Admin Panel > Business Setup > Business Settings* — [v7.x notes summary](https://6amtech.com/?p=25418).
- Known limitation: **no per-zone order shut-off** — disabling orders requires turning off the payment gateway, which affects all zones (vendor-confirmed in comments; docs may be newer) — [CodeCanyon comment summary](https://codecanyon.net/comments/31749539).
- Pending feature requests: hierarchical/local-area selection within zones; restaurant operating in multiple zones — [CodeCanyon comment summary](https://codecanyon.net/comments/31727302).

### Inferences (Zone Setup sub-menu)
- **Zones list** (name, display name, status), **Add new zone** (draw polygon on Google Map, set name), **Edit zone**.
- **Per-zone delivery fee**: minimum delivery charge, per-km delivery charge, maximum delivery fee.
- **Per-zone extra/additional charge** and tax.
- **Business Zone** assignment of restaurants to a zone.
- In multi-module siblings (6amMart): a **Modules** screen (Food/Grocery/Pharmacy/Shop/Parcel) — StackFood is single-module (food) so this is typically absent or fixed.

### Gaps
- Whether StackFood v8 added any per-zone availability toggle (contradicting the older comment) was not confirmed.

---

## Q6. Delivery-man Management

### Takeaway
Full deliveryman module: list, add, approve join requests, vehicle categories, wallet, disbursement, reviews, emergency contacts, plus deliveryman-specific business settings (photo-proof verification, self-registration).

### Cited Findings
- **Deliveryman business settings** live at *Admin Panel > Business Setup > Deliveryman*; **delivery verification** forces photo proof per completed delivery — [v7.1 notes summary](https://6amtech.com/blog/stackfood-v7-1/).
- **Disbursement to deliverymen** via *Admin Panel > Business Settings > Disbursement*; deliverymen settle dues via wallet — [v7.2 notes summary](https://6amtech.com/?p=25418).
- **Manual delivery-man assignment** is an admin dispatch feature — [ctit v7.6 listing](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html).

### Inferences (Delivery Man sub-menu)
- **Delivery men list** (filter by zone, active/inactive, free/busy), **Add delivery man** (name, zone, vehicle, identity type/number, ID image, account info), **Edit**.
- **New delivery-man join requests** (approve/deny).
- **Vehicle category** list/add/edit (with extra per-km charge per vehicle).
- **Deliveryman wallet** (balance, collected cash in hand, payable to admin), **Deliveryman disbursement** list/report.
- **Deliveryman reviews** (view/delete).
- **Emergency contacts** setting (admin and/or per-deliveryman safety contacts).
- Self-registration with custom fields (same custom-field mechanism as restaurant self-registration, v7.2).

### Gaps
- Exact wallet column labels for v8 not confirmed.

---

## Q7. Customer Management

### Takeaway
Customer CRUD + wallet (add/deduct funds, bonuses), loyalty points, customer-facing settings, and subscribed-email capture; loyalty and wallet are confirmed features.

### Cited Findings
- **Customer loyalty points** is a named feature of the 6amtech food stack — [6amtech stackfood-vs-efood](https://6amtech.com/blog/stackfood-vs-efood/).
- Third-party implementation guide confirms configurable loyalty programs and promotional campaigns/coupons — [zoftwarehub analysis summary](https://zoftwarehub.com/en-ae/products/stackfood/zoftware-analysis).

### Inferences (Customer Management sub-menu)
- **Customers list** (search, filter by zone; order count, wallet balance), **Add customer**, customer detail (order history, wallet, addresses).
- **Customer wallet**: add fund / deduct fund (admin adjustment), wallet transaction log, wallet **bonus** setup (bonus on add-fund, by amount/percentage, date range).
- **Loyalty points**: earning rate, point-to-currency conversion, minimum points to convert, settings screen.
- **Customer settings** (wallet on/off, loyalty on/off, referral earning, add-fund on/off, minimum add-fund amount).
- **Subscribed emails / subscribers** list (newsletter signups) with export.
- **Referral** configuration (referral earning amount).

### Gaps
- Whether StackFood exposes a full referral-code report in v8 not confirmed.

---

## Q8. Promotion & Marketing Management

### Takeaway
A Marketing/Promotion module covering campaigns (basic + item/food), banners, coupons, push notifications, cashback, advertisements, and (in later versions) flash sales — "Marketing Section" is a named module; individual tool docs were not fetchable.

### Cited Findings
- **Marketing Section** is an explicitly named admin module — [ctit v7.6 listing](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html).
- Configurable **promotional campaigns, coupons, and loyalty programs** confirmed generically — [zoftwarehub analysis summary](https://zoftwarehub.com/en-ae/products/stackfood/zoftware-analysis).
- **Advertisement** management is a newer 6amtech feature (restaurants request ads, admin approves) — present in the ecosystem — [6amtech featured products](https://6amtech.com/?p=26085) (ecosystem-level; StackFood-specific screen not fetched).

### Inferences (Promotion / Marketing sub-menu)
- **Campaigns**: **Basic campaign** (banner-style, time-boxed, linked to restaurants) and **Item/Food campaign** (specific foods on promo) — list/add/edit, join requests from restaurants.
- **Banners** (promotional banner list/add: image, link to restaurant/food/default, zone, status).
- **Coupons** list/add/edit (code, type: default/free-delivery/first-order/restaurant-wise, discount amount/percentage, min purchase, max discount, limit per user, start/expire date, zone).
- **Push notification** compose & send (title, description, image, target: customer/deliveryman/restaurant/zone; send now).
- **Cashback** setup (percentage/amount, min purchase, max cashback, date range, active toggle).
- **Advertisements** (list, approve/deny restaurant-submitted ads, set priority/placement).
- **Flash sale** (later versions: add flash-sale period, add foods, discount).
- **Promotional banner / "why choose us" / hero** content tied to landing page.

### Gaps
- Exact split between "Campaign (basic)" vs "item campaign" and presence of Flash Sale depends on version; not screenshot-confirmed.

---

## Q9. Subscriptions & Engagement

### Takeaway
Later StackFood versions add a restaurant **subscription package** model (restaurants pay for plans with feature limits) alongside the commission model; customer food-subscription (recurring orders) also exists.

### Cited Findings
- Third-party guide lists **subscription models as an optional feature** of StackFood — [zoftwarehub analysis summary](https://zoftwarehub.com/en-ae/products/stackfood/zoftware-analysis).

### Inferences
- **Subscription packages (restaurant plans):** package list/add/edit (name, price, duration days, feature limits: max orders, max products, POS access, chat, review, self-delivery, mobile-app access), assign/renew per restaurant, subscription transaction report, business model toggle (commission base / subscription base / both).
- **Customer food subscription** (recurring scheduled orders) — order type visible in Order Management.
- Push-notification & email engagement overlap with Q8.

### Gaps
- Package field list is from sibling products (6amMart/eFood); StackFood v8-specific package fields not source-confirmed.

---

## Q10. Transactions & Reports

### Takeaway
A Reports/Transactions module with transaction report, order report, food/item report, restaurant & deliveryman reports, expense report, tax report, disbursement reports, and cash-collection ("collect cash") reconciliation between admin/restaurant/deliveryman.

### Cited Findings
- **Disbursement** feature + **disbursement UI/report** (pay restaurants & deliverymen; settle dues via wallet) — [v7.2 notes](https://6amtech.com/?p=25418), [disbursement redesign post](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/).
- "Reporting and Statistics" and an "Accounts Section" are named admin modules — [ctit v7.6 listing](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html).
- Cash-in-hand / collected-cash reconciliation is standard in this class of product (analogue: restaurant cash book with cash-in/cash-out, bank credit/debit, tax summary by rate) — [Fleksa transaction docs](https://fleksa.com/docs/restaurant-pos/transactions); disbursement-date-filtered transaction reconciliation — [City Hive](https://support.cityhive.net/portal/en/kb/articles/reconcile-bank-disbursements).

### Inferences (Transaction / Report sub-menu)
- **Transaction report** (all wallet/payment transactions, filter by zone/date/type).
- **Order report** (orders by status/zone/restaurant/date, revenue, item count, export).
- **Food/Item report** (sales per food, quantity, revenue).
- **Restaurant report** (per-restaurant orders, earnings, commission, filter).
- **Deliveryman report** (deliveries, earnings, collected cash).
- **Expense report** (admin expenses, e.g. coupon/cashback/referral discounts given, delivery-fee subsidies).
- **Tax report** (collected tax by period/zone).
- **Disbursement reports** (restaurant disbursement, deliveryman disbursement, status pending/completed).
- **Collect cash** screens: *Provided to admin* / *Received from* flows — collect cash from deliveryman, collect cash from restaurant; cash-in-hand ledger.
- **Wallet transaction** report (customer wallet, add-fund, bonus, loyalty conversions).

### Gaps
- Exact report names/columns for v8 not screenshot-confirmed; "expense report" existence in StackFood specifically inferred from ecosystem.

---

## Q11. Business Settings

### Takeaway
A broad "Business Setup / Business Settings" module controlling currency/timezone/time-format, order settings, refund settings, and per-entity settings (customer/deliveryman/restaurant/delivery-fee), plus maintenance mode and order-cancellation reasons.

### Cited Findings
- **Business Settings** is a menu area at *Admin Panel > Business Setup > Business Settings* (e.g., extra/service/platform charge configured here) — [v7.x notes summary](https://6amtech.com/?p=25418).
- **Deliveryman settings** at *Business Setup > Deliveryman* (incl. delivery verification toggle) — [v7.1 notes](https://6amtech.com/blog/stackfood-v7-1/).
- **Disbursement settings** at *Business Settings > Disbursement* — [v7.2 notes](https://6amtech.com/?p=25418).
- **Free Delivery Setup** and **custom self-registration fields** are admin settings — [v7.2 notes](https://6amtech.com/?p=25418).

### Inferences (Business Setup sub-menu)
- **General / Business setup:** business name, logo, favicon, country, currency + symbol position, timezone, time format (12/24h), digit-after-decimal, phone/email, address.
- **Order settings:** scheduled order on/off, home delivery / takeaway / dine-in toggles, order-confirmation model (restaurant/deliveryman), minimum order, DM tips, order delivery-verification OTP, instant order.
- **Refund settings:** enable refund, refund-request active, refund mode (wallet/original), refund cancellation reasons.
- **Customer settings:** wallet / loyalty / referral toggles, add-fund min, free-delivery-over.
- **Deliveryman settings:** registration on/off, delivery-verification photo, cash-limit, commission.
- **Restaurant settings:** registration on/off, approval, default commission, GST/VAT, scheduling.
- **Delivery-fee settings:** per-km charge, min charge, maximum fee, per-zone override.
- **Maintenance mode** (whole system / specific apps, with message).
- **Order cancellation reasons** (add/edit reasons, assign to role), **priority** ordering of list items.
- **Business model** toggle (commission / subscription / both).

### Gaps
- Not every toggle label verified for v8.

---

## Q12. Third-Party Configuration

### Takeaway
A "3rd Party & Configurations" module for payment gateways, SMS gateways, SMTP mail, Google Maps API, Firebase push, social logins, reCAPTCHA, and analytics; most of these are confirmed, and 35+ payment / 14+ SMS gateways are available via a paid add-on.

### Cited Findings
- **Offline payments** toggled under *3rd Party & Configurations > 3rd Party* — [v7.2 notes summary](https://6amtech.com/?p=25418).
- **Payment gateways** (admin on/off each): Cash on Delivery, SSLCOMMERZ, Razorpay, PayPal, Stripe, Paystack, SenangPay, Flutterwave, MercadoPago, PaymentAccept, bKash (varies by product) — [6amtech mandatory-setup summary](https://docs.6amtech.com/docs-six-valley/admin-panel/mandatory-setup).
- **SMS gateway** module handles OTP for account creation & password recovery; **35+ payment & 14+ SMS gateways** sold as a separate Payment & SMS Gateway Add-on ($79 regular / $299 extended), installed via zip upload in the addon section + license key, one project at a time — [6amtech Payment & SMS Gateway Addon](https://6amtech.com/payment-sms-gateway-addon/).
- **Mail (SMTP) config:** mailer name, host, driver, username, sender address, encryption, password; used for password-recovery email — [6amtech mandatory-setup summary](https://docs.6amtech.com/docs-six-valley/admin-panel/mandatory-setup).
- **Firebase push notifications** at *3rd Party > Push Notification > Firebase Configuration* (create project, generate service-account JSON, paste into "Service File Content"); on/off per order-status notification — [6amtech mandatory-setup summary](https://docs.6amtech.com/docs-six-cash/admin-panel/mandatory-setup).

### Inferences
- **Map API** (Google Maps key — client + server key; used for zones, geocoding, distance).
- **Social login** config (Google, Facebook, Apple).
- **reCAPTCHA** (site/secret key) — *not source-confirmed* (see Gaps).
- **Analytics** (Google Analytics / Google Tag Manager / Pixel) config.
- **Firebase OTP / auth**, **offline payment method builder** (define custom offline methods & input fields).

### Gaps
- No 6amtech doc on **reCAPTCHA** location was retrievable — [confirmed missing in search](https://6amtech.com/payment-sms-gateway-addon/). Existence is likely (present in siblings) but unverified for StackFood.

---

## Q13. Content / CMS

### Takeaway
A Content/Pages module: landing-page builder, legal/policy pages (terms, privacy, about, refund/cancellation/shipping policy), FAQ, social links, app settings & URLs, languages/translations, fonts, theme/colors, and branding assets.

### Cited Findings
- **Mail config** is used for website password-recovery (CMS/website is a distinct front-end managed from admin) — [6amtech mandatory-setup summary](https://docs.6amtech.com/docs-six-valley/admin-panel/mandatory-setup).
- A **React web front-end** exists and is configured/branded from admin (disbursement UI post references the react website) — [6amtech post](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/).
- Multilingual support is a named feature — [v8.5 listing summary, treat with caution/nulled source](https://dknullzone.run.place/?p=12764).

### Inferences (Content / Settings sub-menu)
- **Landing page settings** (hero, feature sections, download links, testimonials, toggle sections on/off).
- **Pages:** Terms & Conditions, Privacy Policy, About Us, Refund Policy, Cancellation Policy, Shipping Policy — each a rich-text editor.
- **FAQ** list/add/edit.
- **Social media links** list/add/edit.
- **App settings:** app store / play store URLs, app version, force-update, app maintenance.
- **Languages / translations:** add language, set default, key-value translation editor.
- **Fonts** selection; **Theme / colors** (primary/secondary); **Logos & favicon** upload.
- **Business logos / login-page images**.

### Gaps
- CMS screen granularity for v8 not screenshot-confirmed.

---

## Q14. System / Platform Administration

### Takeaway
System-level tools: database backup, add-on/module management, software/version/license status, clean/clear-data, and cron setup — addon management and licensing are confirmed via the add-on product.

### Cited Findings
- **Add-on / module management** screen exists: add-ons installed by uploading a .zip in the admin's addon section then activating with a license key — [6amtech Payment & SMS Gateway Addon](https://6amtech.com/payment-sms-gateway-addon/).
- **License activation** is required for the core product and add-ons (Codecanyon purchase/license code) — [CodeCanyon item](https://codecanyon.net/comments/31749539).
- **Cron** setup is part of the standard installation (order scheduling, subscription expiry) — [6amtech mandatory-setup summary](https://docs.6amtech.com/docs-six-valley/admin-panel/mandatory-setup).

### Inferences
- **Database backup** (download DB backup from admin).
- **System addon** list (installed modules, activate/deactivate, upload new).
- **Software / version / update** screen (current version, update/migrate).
- **Clean / clear data** (reset demo data, clear cache).
- **Cron job** instructions/status.

### Gaps
- Exact system-menu labels for v8 not screenshot-confirmed.

---

## Q15. Employee / Role & Permission Management

### Takeaway
Role-based access control: create roles with module-level permissions, create employees/admins, assign roles.

### Cited Findings
- **Role-based access**: the Super Admin web panel supports assigning role-based access; "Employee Section" is a named module — [docs summary](https://docs.6amtech.com/docs-stack-food/intro), [ctit v7.6 listing](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html).

### Inferences
- **Employee roles** list/add/edit (role name + checkbox grid of module permissions: dashboard, orders, foods, restaurants, delivery-men, customers, reports, settings, etc.).
- **Employees / admins** list/add/edit (name, image, contact, role assignment, zone scope, active/inactive, login credentials).
- Module-level access gating of the whole left-nav per role.

### Gaps
- Whether permissions are per-action (CRUD) or per-module only in v8 not confirmed.

---

## Q16. DoorDash / Uber Eats / Deliveroo / Just Eat — Platform-Ops & Back-Office Equivalents

### Takeaway
The big-4 don't expose a single "super-admin panel"; their back-office is split into (a) internal ops/risk tooling (fraud, disputes, chargebacks, onboarding ops, courier ops, zone/market management) and (b) merchant-facing self-serve portals (menu, hours, analytics). Public detail is thin on internal tools; merchant portals are well-documented.

### Cited Findings
- **DoorDash fraud/risk ops:** a dedicated Risk/Fraud Operations team; early fraud prevention was largely **manual review**, later augmented by a rules engine and Sift's Payment Protection (chose a vendor rather than build internally due to bandwidth); work includes monitoring alerts, analyzing transactional data + user-behavior patterns, identifying new abuse vectors — [Sift case study](https://pages.sift.com/rs/526-PCC-974/images/Sift_CaseStudy_Doordash_062823.pdf), [DoorDash Fraud Specialist job](https://www.themuse.com/jobs/doordash/fraud-specialist-510727).
- **DoorDash merchant onboarding ops:** a Merchant Services Escalations team resolves onboarding/activation issues, handles escalated activation cases, roots-causes escalations; onboarding staff phone consumers/Dashers/merchants to verify info and collect onboarding documents — [Merchant Services Escalations role](https://www.themuse.com/jobs/doordash/merchant-services-escalations-specialist).
- **DoorDash chargebacks/disputes:** ToS prohibit fraudulent chargebacks; merchants get 14 calendar days from chargeback notification to dispute with evidence (receipts, delivery confirmation, customer comms) — [conductatlas ToS tracker](https://conductatlas.com/platform/doordash/doordash-terms-of-service/prohibition-on-fraudulent-chargebacks/).
- **Deliveroo Partner Hub — Menu Manager:** edit items & photos, add categories, publish one menu across multiple sites; page shows how many sites/schedules a menu has; duplicate menus; delete only if unassigned; without access, request changes via form (up to 3 days) — [Deliveroo help: Menu Manager](https://help.deliveroo.com/en/articles/3524899-managing-your-deliveroo-menu-in-partner-hub), [view/remove menus](https://help.deliveroo.com/en/articles/6059699-how-can-i-view-and-remove-my-deliveroo-menus).
- **Just Eat Partner Hub:** daily-ops surface — set/change opening hours, public-holiday & temporary-closure updates; add menu items with descriptions/images; mark items "unavailable" when sold out; **Analytics** section with revenue, number of orders, hourly insights; menu changes go live near-instantly — [Just Eat partner blog](https://www.just-eat.ie/partner-blog/?p=1352), [Partner Hub app listing](https://foxdata.com/ru/app-marketing-analytics/1039863376/as/GB/just-eat-takeaway-partner-hub/).
- **Cross-platform menu/dietary ops (via POS middleware):** dietary tags & menu descriptions pushed to Deliveroo/Uber Eats/Just Eat; order management across Deliveroo/Just Eat/Uber Eats/Flipdish from one dashboard — [Zonal release notes](https://knowledge.zonal.co.uk/ordering/Content/Zonal%20Delivery/Overviews/Whats%20New.htm), [UrbanPiper](https://www.urbanpiper.com/manage-online-orders/en-sa).

### Inferences (platform-ops capability map, high level)
- **Common internal-ops domains across all four:** fraud/abuse detection & manual review queues; payment-dispute/chargeback handling; refund & credit adjudication; merchant onboarding/activation & menu QA (photo/description compliance); courier/Dasher ops (onboarding, deactivation, background checks, live dispatch/assignment, earnings & payout disputes, support escalation); market/zone management (launch new markets, set delivery radius, surge/busy pricing); pricing & promotions ops (fee setup, promo funding, ad products); catalog/menu ingestion & QA tooling; support/CRM case tooling for consumer/merchant/courier contacts.
- **Merchant self-serve portals (analogue to StackFood restaurant panel):** DoorDash **Merchant Portal / Business Manager**, Uber Eats **Uber Eats Manager**, Deliveroo **Partner Hub**, Just Eat **Partner Hub** — each covers menu management, store hours/holidays, item 86-ing (sold-out), order history, payouts/invoices, reviews/ratings, analytics (sales, orders, customer insights), promotions/ads self-serve, and multi-location management.

### Gaps
- **Uber Eats** internal-ops and merchant-portal specifics were not returned by search (only cross-platform middleware mentions). No internal tool *names*/architecture for any of the four were retrievable; detail is limited to job-posting descriptions, help-center pages, and one vendor case study (treat Sift results-claims with caution).

---

## Cross-Cutting Notes for the Build Backlog
- **Menu-path convention (confirmed):** StackFood admin nests things as *Admin Panel > {Business Setup | Food Management | Business Settings | 3rd Party & Configurations} > ...*. Use these as the top-level left-nav groups.
- **Shared admin shell:** StackFood, eFood, 6amMart (multi-vertical), GroFresh, Six Valley share one Laravel admin template; 6amMart/GroFresh add a **Modules** screen (Food/Grocery/Pharmacy/Shop/Parcel) and **Stores** instead of "Restaurants." StackFood is food-only.
- **Separate panels:** (1) Super-Admin web (Laravel), (2) Restaurant web panel (role-based), (3) React customer website, (4) Flutter customer/restaurant/delivery apps (sold separately/combo). Admin configures and brands all of them.
- **Paid add-ons** extend the admin: Payment & SMS Gateway add-on (35+/14+ gateways); other 6amtech add-ons exist and install via the system addon screen with a license key.
- **Primary-source verification still owed** (all blocked here): `docs.6amtech.com/docs-stack-food` full sidebar, `preview.6amtech.com` live admin demo, and a current CodeCanyon feature list for v8+ — these would confirm exact v8 screen names and the ~150-screen count.
