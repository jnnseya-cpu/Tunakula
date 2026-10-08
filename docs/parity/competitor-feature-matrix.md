# Four actors, five platforms, one build backlog

This report converts a deep competitive extraction of **StackFood, DoorDash, Uber Eats, Deliveroo, and Just Eat** into a definitive, screen-by-screen build backlog organized around the four actor types a food-delivery platform must serve: **Customer, Restaurant/Merchant, Rider/Courier, and Admin/Platform-ops**. The headline finding is that **StackFood — the 6amTech Laravel + Flutter CodeCanyon product that is the primary benchmark — already ships the widest native breadth of any single actor's features**, especially on the admin side (a ~150-screen Laravel back office with zones, wallets, disbursement, commission/subscription models, and COD reconciliation), while the big-4 Western platforms outclass it on a specific, repeatable set of high-value features: **membership subscriptions (DashPass/Uber One/Deliveroo Plus), group ordering and bill-split, rich dietary/allergen filtering, driver safety toolkits, performance tiers with incentives/quests, instant cash-out, and formal merchant analytics/scorecards**. StackFood's standout differentiators that the Western platforms mostly lack are **cash-on-delivery with "Cash in Hand" remittance, an in-app customer wallet with partial payment, pluggable multi-gateway/mobile-money payments, native dine-in, and a built-in free POS**. Because several primary StackFood sources were egress-blocked during research, a meaningful slice of StackFood specifics below are high-confidence product-knowledge inferences rather than source-verified facts, and are marked accordingly so a product team knows exactly which backlog items to confirm against the live codebase before committing. The closing section consolidates everything into a cross-actor feature superset mapped to epics and stories, ready to drop into a backlog.

> **Sourcing caveat — read before building.** All primary StackFood properties (`docs.6amtech.com`, `preview.6amtech.com` live demo, `6amtech.com` blog, `apps.apple.com`, CodeCanyon, and nulled mirrors), plus several merchant/driver help domains (`merchants.doordash.com`, `partner.just-eat.co.uk`, `help.doordash.com`, `dasher.doordash.com`) were **blocked by the network egress proxy**. Only WebSearch *summaries* of those pages were retrievable. Consequently: (1) items with an inline `([Source](URL))` are source-cited; (2) items tagged **[INF]** are inferences from the researchers' knowledge of the StackFood v7.x–v8.x codebase/demo and the 6amTech ecosystem (StackFood, eFood, 6amMart, GroFresh, Six Valley share one admin shell) — treat these as a high-confidence but **source-unverified** backlog to validate against the `user_app`/`store_app`/`restaurant_panel`/Laravel admin source and the current CodeCanyon v8 listing. Legend used throughout: **✔** confirmed via source, **~** inferred/partial, **✘** absent/not offered, **?** unknown (not confirmed either way this pass).

---

# Actor 1 — Customer (Eater)

## Onboarding, account, and profile
All five platforms support account creation with saved addresses, saved payment methods, and order history; social/Apple/Google login is common; **guest checkout** exists on StackFood, Just Eat, and (for host-paid group orders) Uber Eats ([Uber Eats group ordering](https://www.uber.com/business/solutions/eats/group-ordering/)). **StackFood shipped guest checkout, scheduled orders, free-delivery option, online cart sync, and offline/manual payment in v7.2** ([6amtech v7.2](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)). Just Eat stores saved addresses, past orders, ratings/reviews, and saved cards for faster re-ordering, with social login + mobile verification ([Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md); [Internet Retailing](https://internetretailing.net/?p=32439)).

| Feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Phone + SMS OTP login | ~ [INF] | ? | ? | ? | ~ |
| Email/password login | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Google / Facebook / Apple social login | ~ [INF] | ? | ✔ | ? | ~ |
| Guest checkout / guest mode | ✔ | ? | ✔ (group) | ? | ~ |
| Admin-toggle login methods + OTP channel | ~ [INF] | ✘ | ✘ | ✘ | ✘ |
| Profile (name, email, phone w/ verify, image) | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Multiple saved addresses (type, map-pin, reverse-geocode, floor/house/road/contact) | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Saved payment methods / cards on file | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Language selection + RTL | ~ [INF] | ? | ? | ? | ? |
| Dark mode / theme toggle | ~ [INF] | ? | ? | ? | ? |
| Account deletion request, notification prefs | ~ [INF] | ✔ | ✔ | ✔ | ✔ |

**StackFood call-out:** language selection, RTL, dark mode, and admin-configurable login/OTP matrices are StackFood-distinctive configurables [INF]; the exact v8 login-method default set (incl. whether Apple login is on by default) could not be verified (vendor pages blocked).

## Discovery (home, search, filters, sort, map)
Rich home surfaces — banners, categories/cuisines, popular/nearby/new/promoted collections — plus filter and sort are universal. **Uber Eats and Deliveroo lead on dietary/allergy filtering**: Uber Eats has had an allergy-friendly section and dietary/price/delivery-speed filters with tailored recommendations since 2019 ([Uber newsroom](https://www.uber.com/newsroom/making-food-delivery-more-accessible-sustainable); [MobileSyrup](https://mobilesyrup.com/2019/11/25/uber-eats-allergy-friendly-filter/); [TechCrunch](https://techcrunch.com/2017/04/18/ubereats-gets-custom-suggestions-food-filters-and-drop-off-instructions)). Just Eat offers a **map view of restaurants** and a groceries vertical in Takeaway markets ([Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)).

- **StackFood home modules [INF]:** search bar, promo banners/sliders, category icons, popular foods, popular/most-reviewed restaurants, nearby restaurants, new restaurants, "Order again" row, campaigns (basic + item), discounted/offer items, best-reviewed items; location picker driving the zone-based list.
- **Search/filter [INF]:** recent searches + suggestions; filters for veg/non-veg, category, rating; sort by top-rated/nearest/discount; product- and restaurant-level search.
- **Restaurant cards [INF]:** name, logo/cover, cuisine tags, avg rating + review count, distance, est. delivery time, delivery fee / free-delivery badge, min order, open/closed, discount badge, favorite heart toggle.

**Gap to close for a StackFood rebuild:** StackFood's dietary filtering is essentially **veg/non-veg only** — no structured allergen/halal/dietary-profile filter set like Uber Eats/Deliveroo. Deliveroo's exact home collections ("Picked for you," offers rail) were not captured from an official page this pass.

## Store/restaurant page and item detail
Menu-category browsing, item detail with variations + add-on modifiers, special-instruction notes, veg flags, sold-out/availability, and opening-hours scheduling are common across all five. **Uber Eats lets a diner flag allergies on a specific dish** and the restaurant can message back with an alternative ([Uber newsroom](https://www.uber.com/newsroom/making-food-delivery-more-accessible-sustainable)). **Deliveroo requires age-restricted items (alcohol) to be tagged on the menu** ([Deliveroo partner hub](https://help.deliveroo.com/en/articles/4775074-managing-age-restricted-items-in-partner-hub)).

- **StackFood store page [INF]:** cover/logo, rating, delivery time/fee/min-order header, search within menu, food-category sections, "Recommended"/popular items, veg/non-veg toggle.
- **StackFood item detail [INF]:** image, description, price, variation groups (single/multi-select with price deltas), paid add-ons with quantity, quantity stepper, special-instruction note, veg indicator, favorite toggle, share.
- **StackFood availability [INF]:** per-item time-window schedule, sold-out/out-of-stock state, per-day opening hours, pre-order when closed.

**Gap:** structured nutrition/calorie display (mandated in some UK/EU menus) is rich on Uber Eats/Deliveroo/Just Eat in applicable regions but minimal/unconfirmed in StackFood.

## Cart, checkout, and order types
Delivery + pickup/takeaway are universal; **dine-in and scheduled/pre-order appear on StackFood**; **group order is a flagship on Uber Eats and DoorDash**. Uber Eats group orders let a host share a cart link, set a checkout deadline up to 7 days out (with auto- or manual-checkout modes), with 15+-person orders scheduled ≥24h ahead ([Uber AU blog](https://www.uber.com/en-AU/blog/split-your-uber-eats-order-with-the-team/); [Restaurant Dive](https://www.restaurantdive.com/news/uber-eats-brings-back-group-ordering-with-enhanced-features/620068/)). DoorDash supports pickup with online pay + estimated pickup time, scheduled deliveries, group orders, and contactless delivery ([Appello](https://appello.com.au/articles/how-to-create-an-app-lke-doordash); [DoorDash Help](https://help.doordash.com/en-ca/merchants/article/order-pickup)).

| Order type / checkout feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Delivery | ✔ | ✔ | ✔ | ✔ | ✔ |
| Pickup / takeaway | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Dine-in (table/QR) | ~ [INF, v8] | ✘ | ✘ | ✘ | ✘ |
| Scheduled / pre-order | ✔ | ✔ | ✔ | ~ | ✔ |
| Group order + bill split | ✘ | ✔ | ✔ | ? | ? |
| Cart edit (qty, remove, item notes) | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Delivery instructions / note to rider | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Cutlery opt-out toggle | ~ (region) | ? | ? | ? | ? |
| Fee breakdown (subtotal, delivery, discount, VAT, service charge, tip) | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Tip at checkout (preset + custom) | ~ [INF] | ✔ | ✔ | ? | ? |
| Minimum-order enforcement | ~ [INF] | ✔ | ✔ | ✔ | ✔ |

**StackFood call-out:** **group order + bill-split is absent** from StackFood and is a clear Uber Eats/DoorDash differentiator to add to the backlog. Scheduled orders, free delivery, and online cart sync are confirmed in StackFood ([6amtech v7.2](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)).

## Payments
**StackFood is the most gateway-flexible of the five.** It confirms **partial payment** (pay part from in-app wallet, remainder via COD and/or digital — e.g. $30 wallet + $70 card on a $100 order) and **offline/manual payment with admin verification**, alongside COD, cards, and online wallets ([6amtech v7.2](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/); [6amTech](https://6amtech.com/blog/stackfood-vs-efood/)). The Western platforms rely on cards + Apple/Google Pay + PayPal + their own credits/wallets; **cash is largely absent in Western markets** but present on Just Eat ([Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)).

| Payment method | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Cash on Delivery | ✔ | ✘ (mostly) | ✘ (mostly) | ✘ (mostly) | ✔ |
| Cards (gateway-tokenized) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Pluggable multi-gateway (Stripe/PayPal/Razorpay/Paystack/Flutterwave/SSLCommerz/bKash/…) | ✔ [INF] | ✘ | ✘ | ✘ | ✘ |
| Mobile money / local wallets | ✔ [INF] | ✘ | ✘ | ✘ | ✘ |
| In-app wallet + add-fund + partial pay | ✔ | ~ (credits) | ~ (credits) | ~ (credit) | ? |
| Apple Pay / Google Pay | ~ (gateway-dependent) | ✔ | ✔ | ✔ | ✔ |
| PayPal | ~ [INF] | ? | ? | ? | ✔ (Takeaway) |
| Offline / manual payment (admin-verified) | ✔ | ✘ | ✘ | ✘ | ✘ |
| Promo/coupon field at checkout | ~ [INF] | ✔ | ✔ | ✔ | ✔ |

**Note:** StackFood's "partial payment" is single-user wallet-plus-method, **not** person-to-person bill-splitting; bill-split lives inside Uber Eats group orders.

## Promotions, loyalty, and membership
StackFood natively bundles coupons, cashback, in-wallet loyalty points, referral, and campaigns; its **referral program credits referral points to the wallet** after the invitee registers ([6amtech](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)). The big-4's defining edge is **paid membership subscriptions** plus structured loyalty:
- **DoorDash DashPass** (~$9.99/mo): $0 delivery + reduced service fees on eligible orders meeting a minimum, plus exclusive deals ([Kudos](https://www.joinkudos.com/blog/doordash-dashpass-vs-uber-one-which-saves-more)).
- **Uber One** ($9.99/mo or $96/yr): $0 delivery on eligible Eats/grocery orders, 6% ride credits, 2025 additions (Surge Savings, Tuesday fresh-item discounts, Lime credits, Member Days) ([Uber blog](https://www.uber.com/blog/new-benefits-for-uber-one-members-2025); [SmallBizTrends](https://smallbiztrends.com/uber-launches-new-everyday-savings-features-2025/)).
- **Deliveroo Plus** (free delivery + members-only deals; UK £8.99/mo or £89/yr) and **Plus Diamond** (UK 2024, £19.99/mo: priority delivery, full credit back if >10 min late, 10% credit on orders over £30) ([Expat Living](https://expatliving.sg/food-delivery-apps-singapore-deliveroo-plus); [City AM](https://www.cityam.com/deliveroos-testing-amazon-prime-style-delivery-subscription/); [Verdict Foodservice](https://www.verdictfoodservice.com/newsletters/deliveroo-plus-diamond-subscription-service)).
- **Just Eat Stamp Cards**: earn 1 stamp/order (each worth 10% of order excl. fees); after 5 stamps the 6th order gets an auto-applied discount; restaurant-specific ([Just Eat Extra Helpings](https://extrahelpings.just-eat.ie/stampcards)).

| Promotion feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Coupons / promo codes (%, fixed, first-order, per-user limit, min-spend) | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Cashback / loyalty points → wallet | ~ [INF] | ? | ? | ? | ✔ (Stamp Cards) |
| Campaigns (basic + item) | ~ [INF] | ? | ? | ? | ? |
| Referral program | ✔ | ? | ? | ? | ? |
| Paid subscription membership | ✘ | ✔ DashPass | ✔ Uber One | ✔ Plus / Plus Diamond | ~ |

**StackFood call-out:** **no native subscription/membership tier** — the single biggest customer-side gap vs the big-4, and a prime backlog epic. Exact StackFood loyalty earning/redemption mechanics could not be verified (pages blocked).

## Order lifecycle (tracking, chat, history, reorder, cancel, refund, rate)
Live map tracking with courier + ETA, status steps, in-app chat/call, order history, and one-tap reorder are universal. DoorDash lets eaters follow each stage, chat with the courier, reorder, manage multiple orders, and **tip before or after delivery** ([GetApp](https://www.getapp.com/retail-consumer-services-software/a/doordash/reviews/); [RideshareGuy](https://therideshareguy.com/doordash-driver-app-feature-requests/)). Just Eat offers a live tracker with push updates and reorder-from-history ([Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)). Deliveroo lets eaters cancel until the restaurant starts preparing and proactively calls if an order may be late ([Deliveroo IE FAQ](https://deliveroo.ie/faq); [Deliveroo help](https://help.deliveroo.com/)).

- **StackFood [INF]:** status steps (pending → confirmed → processing/cooking → handover → out for delivery → delivered); live map with delivery-man location + route + ETA once assigned; in-app chat (text + image) with admin/restaurant/delivery man; call via phone; order history (running + past) with itemized receipt, reorder, track; cancel with reason while cancellable; refund request (admin-mediated, to wallet or source); post-delivery rating of **restaurant + item + delivery-man (separate)** plus written review.
- **Gap:** StackFood in-app **edit-order-after-placement** (add/remove items) is typically unsupported for customers (cancel + reorder instead) — unconfirmed this pass.

## Engagement, help, and verticals
Reviews/ratings (restaurant + item), favourites, multi-channel notifications (push/SMS/email + in-app center), and in-app help/chat are common; StackFood supports favourites, reviews, and Firebase push + SMS (OTP/order) + email [INF]. The big-4 extend into **grocery/convenience, corporate accounts, gift cards, and age-verified alcohol** — all areas StackFood lacks natively.

| Vertical / special feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Favourites (restaurants + items) | ~ [INF] | ? | ~ | ? | ✔ |
| Reviews/ratings (restaurant + item + courier) | ~ [INF] | ? | ? | ~ | ✔ |
| Grocery / convenience vertical | ✘ (separate 6amMart product) | ✔ | ✔ | ✔ | ✔ (Takeaway) |
| Alcohol / age verification | ✘ | ? | ? | ✔ | ? |
| Gift cards | ✘ | ✔ | ✔ | ? | ✔ |
| Corporate / business accounts | ✘ | ✔ | ✔ | ✔ (Plus for companies) | ? |

**Deliveroo alcohol flow (reference pattern for a backlog):** checkout 18+ confirmation → two in-app reminders to have ID ready → rider ID scan (DOB + expiry) + visual match at door → remove age-restricted items if underage/no ID but keep the rest ([Deliveroo partner hub](https://help.deliveroo.com/en/articles/4775074-managing-age-restricted-items-in-partner-hub); [Deliveroo rider guidance](https://rider.deliveroo.co.uk/delivering-alcohol)).

---

# Actor 2 — Restaurant / Merchant

## Onboarding, account, verification, and staff roles
All four commercial platforms support self-service or guided signup, business/tax verification, bank/payout setup, store-profile editing, multi-location switching, and tiered staff roles. **Uber Eats onboarding is 4 steps** (signup form → business details → add menu → turn on Orders app) with multi-location via Stores → Add and a **3-tier role model (Staff → Manager → Admin)** ([Uber Eats signup](https://www.ubereats.com/restaurant/en-US/onboarding/contract); [Uber Eats Manager](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)). DoorDash applies menu/role changes across one or all locations via Business Manager ([DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/orders-and-store-management)).

**StackFood** supports two selectable business models per restaurant — **commission-based and subscription-based** — with admin-defined rates and digital payment of fees ([StackFood product page](https://preview.6amtech.com/page/stack-food-multi-restaurant-food-delivery-app-with-laravel-admin-and-restaurant-panel)), plus zone-based coverage, multilingual support, and Marketing/Employee/Accounts sections ([6amtech listing](https://6amtech.com/?p=25418)). StackFood restaurant_panel [INF]: vendor self-registration with logo/cover upload and lat/long pin, **admin-approval gate** (verification is admin-manual, not automated KYC), store profile, a **bank-information page** for withdrawals, per-vendor GST/VAT, a multi-branch "sub-stores" concept in later versions, and an **Employee Role module** (custom roles with module-level permissions) mirroring the admin panel.

## Order management (live board, accept/reject, prep, handover, printing)
All platforms provide a live incoming-order board (tablet/app) with accept/reject, prep-time setting, status progression, sound alerts, history/detail, and printing. **DoorDash Order Manager** (rented/own Android tablet) receives + tracks delivery/pickup, marks items out of stock, and updates hours; **Business Manager** (phone) handles real-time orders + feedback; stores can pause during busy periods ([DoorDash](https://merchants.doordash.com/en-us/products/orders-and-store-management)). **Just Eat Orderpad** is the order-taking tablet, with per-weekday prep-time extension ([Just Eat](https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders)). **Deliveroo's tablet** (sold with printer, or own-device + Partner Hub) shows order detail, rider status, and pickup times ([Deliveroo technology](https://restaurants.deliveroo.com/en-hk/technology)).

**StackFood store_app** confirms Earning Summary, status-wise Active Order list, filters, Add New Food, Restaurant Settings, Add Category/Sub-category ([6amtech](https://6amtech.com/?p=25418)); v7.2 added **order re-assignment** (to a different deliveryman if self-delivery is on), cash-in-hand overflow handling, custom display message, and digital dues payment ([6amtech](https://6amtech.com/?p=25418)). StackFood supports two **order-confirmation models — restaurant-first (default) and deliveryman-first — plus admin-toggled Instant Order** ([6amtech](https://6amtech.com/blog/stackfoods-order-confirmation-models/)), and two notification modes: **Firebase (pop-up) and Manual (continuous alert every 10s until viewed)**, with documented background/foreground sound bugs ([CodeCanyon comments](https://codecanyon.net/comments/31708940)).

- **StackFood order flow [INF]:** tabs for All/Pending/Accepted/Confirmed/Processing/Handover/Picked Up/Delivered/Canceled/Refunded; detail with items, add-ons, note, address/map, payment method; Accept/Reject (reason); set/adjust prep time; mark ready/handover; history with date filter + search; POS screen for walk-in/dine-in.
- **Gap:** none of the five ship a first-party KDS beyond tablet lists (KDS via POS partners); StackFood lacks commercial-grade auto-accept and granular reject-reason taxonomies.

## Menu management
All platforms offer web menu editors with categories/items/modifiers, photos, pricing, out-of-stock toggles, and dayparting; the big-4 sync from POS. **DoorDash Menu Editor** supports add-ons/modifiers, temporary out-of-stock, photo/description edits, and **Daypart menus** by time/day ([DoorDash](https://merchants.doordash.com/en-us/products/orders-and-store-management)). **Deliveroo Menu Manager** edits items/photos, adds categories, publishes one menu across multiple sites, and duplicates/deletes menus ([Deliveroo](https://help.deliveroo.com/en/articles/3524899-managing-your-deliveroo-menu-in-partner-hub)). **Just Eat** lets merchants add items anytime, flag sold-out (auto-returns next day), and change prices with near-instant go-live ([Just Eat](https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders)).

**StackFood food management [INF]:** Category + Sub-category CRUD; food item with name/description/image/price/discount, variations (min/max select), paid add-ons, veg/non-veg, nutrition text, allergen field, max order quantity, per-item available-from/to window, per-language name/description via the multilingual table, active/inactive + recommended flags.

| Menu feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Categories / items / modifiers | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Item photos / descriptions | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Variations w/ required min/max | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Veg / dietary / allergen tags | ~ (veg + allergen text) | ✔ | ✔ | ✔ (14 EU) | ✔ (14 EU) |
| 86-ing / sold-out w/ auto-reactivate | ~ [INF] | ✔ | ✔ | ✔ | ✔ |
| Dayparting / scheduled menus | ~ (item windows) | ✔ | ✔ | ✔ | ✔ |
| Per-language menu | ~ [INF] | ? | ✔ | ✔ | ✔ |
| Bulk import/export | ~ (admin-side) | ✔ (POS) | ✔ (POS) | ✔ (POS) | ✔ (POS) |
| Menu-approval workflow before live | ✘ (instant) | ✘ (instant) | ✔ | ✔ | ✘ (instant) |

## Store operations
All platforms set opening hours, pause/close (busy mode), and extend prep; **Just Eat and StackFood set hours per day**. DoorDash pauses stores during busy periods ([DoorDash](https://merchants.doordash.com/en-us/products/orders-and-store-management)); Just Eat adds prep minutes per weekday and sets delivery area in Partner Hub ([Just Eat](https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders)). StackFood has **zone-based coverage drawn on a map**, but a vendor confirmed there is **no option to disable orders for a specific zone** ([CodeCanyon](https://codecanyon.net/comments/31708940)).

- **StackFood [INF]:** per-day open/close schedule, temporary-close toggle, delivery-time estimate, minimum order, scheduled delivery; **delivery radius/zone is admin-controlled (polygons), not vendor-set**. Busy-mode/order-throttling and special/holiday-hours overrides are weaker than the big-4 (which all support throttling + holiday overrides).

## Promotions & marketing (merchant side)
Commercial platforms have rich self-serve promotion + paid-ads + loyalty suites. **DoorDash Promotions/Sponsored Listings** (pay-per-order ads, claimed 4.1x ROAS; Storefront for commission-free direct orders) ([DoorDash Promotions](https://merchants.doordash.com/en-us/products/promotions); [DoorDash ads](https://about.doordash.com/en-au/news/doordash-launches-new-ad-solution-levelling-the-playing-field-for-merchants-of-all-sizes)). **Deliveroo Marketer** creates offers with an offer-performance report ([Deliveroo](https://help.deliveroo.com/en/articles/6589645-understanding-offer-performance)). **Just Eat Promoted Placement** is cost-per-click top-5 placement (eligibility: Food Hygiene 3+, CX Score 25+), plus StampCards and TopRank ([Just Eat FAQ](https://partner.just-eat.co.uk/blog/marketing-promotion/promoted-placement-faq)). **StackFood** ships built-in **campaigns & discounts** ([StackFood product page](https://preview.6amtech.com/page/stack-food-multi-restaurant-food-delivery-app-with-laravel-admin-and-restaurant-panel)); its merchant-side marketing is coupons, basic + item campaigns (join/leave), banner/advertisement requests to admin, and push sends [INF] — **no native BOGO/happy-hour builder** like DoorDash.

## Pricing, financials, and payouts
Commercial platforms expose commission/plan, payout schedules, invoices, tax docs (1099-K US, VAT UK/EU), and earnings in-portal; **Uber Eats Reports** download payments/operations/feedback detail ([Uber Eats Manager](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)). **StackFood** exposes commission-vs-subscription visibility, an **Earning Summary**, a wallet with **withdrawal requests** (buyers report having to re-enter bank details each withdrawal), cash-in-hand overflow, and digital dues payment, with a redesigned disbursement system ([CodeCanyon](https://codecanyon.net/comments/31708940); [6amtech disbursement](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)). **StackFood gap:** no formal partner invoice/tax-document generation like Uber/Just Eat. **DoorDash tablet rental:** $6/wk US, $3/wk Canada, $0 AU/NZ ([DoorDash](https://merchants.doordash.com/en-us/products/orders-and-store-management)).

## Analytics & reporting (merchant side)
All commercial platforms have analytics dashboards with sales, operations, feedback, and customer-group insights plus **performance scorecards** StackFood lacks:
- **Uber Eats:** Sales, Operations (inaccurate orders/refunds/chargebacks + problem heatmap), Top Eats badge, Customer groups (new/returning/lapsed), Feedback ([Uber Eats Manager](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)).
- **Deliveroo Hub:** Performance, Availability, Customers, Speed, Orders, Items sold, ratings trend + recommendations ([Deliveroo](https://help.deliveroo.com/en/articles/6463245-how-to-view-and-use-reports-in-hub-excluding-signature-partners); [new Hub](https://help.deliveroo.com/en/articles/9515129-how-to-use-the-new-hub-homepage)).
- **Just Eat:** revenue, orders, hourly insights, **Performance Score** with recommendations ([Just Eat Partner Hub](https://foxdata.com/jp/app-marketing-analytics/1039863376/as/GB/just-eat-takeaway-partner-hub/)).
- **StackFood [INF]:** sales report, order report, earning/transaction report, expense, most/least-sold items — **no acceptance-rate/downtime scorecard** (Uber Top Eats / Just Eat Performance Score / Deliveroo recommendations) and shallower customer-insight/ratings analytics.

## Customer interaction & dispute handling
All commercial platforms let merchants read/reply to reviews, handle refunds/adjustments, cancellations, and missing-item disputes; **Uber Eats offers configurable auto-replies to feedback and chargeback visibility** ([Uber Eats Manager](https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/)); DoorDash Business Manager resolves issues and answers feedback ([DoorDash](https://merchants.doordash.com/en-us/products/orders-and-store-management)). **StackFood [INF]:** ratings/reviews per item + store (reply in later versions), refund-request handling (approve/reject + reason), order cancellation with reason, and a customer chat/conversation module in v8.x; missing-item handling is manual via refund/cancel.

## Integrations, devices, and delivery options
All commercial platforms integrate POS/middleware (Deliverect/Otter/UrbanPiper), ship/rent a tablet+printer, and support self vs platform delivery, pickup, dine-in/QR, and virtual brands. **StackFood ships a built-in free POS** ([StackFood product page](https://preview.6amtech.com/page/stack-food-multi-restaurant-food-delivery-app-with-laravel-admin-and-restaurant-panel)) and a **Self-Delivery toggle** (admin-enabled per restaurant; if on, restaurant bears delivery cost + sees re-assign; if off, admin bears it and the feature hides) ([6amtech](https://6amtech.com/blog/stackfoods-order-confirmation-models/)).

| Merchant integration/delivery feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Built-in POS | ✔ | ✘ (partner) | ✘ (partner) | ✘ (partner) | ✘ (partner) |
| 3rd-party POS marketplace | ✘ (it IS the POS) | ✔ | ✔ | ✔ | ✔ |
| Platform delivery (admin couriers) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Self-delivery (own riders) | ✔ | ✔ | ✔ | ~ | ✔ |
| Pickup / takeaway | ✔ | ✔ | ✔ | ✔ | ✔ |
| Dine-in / QR table ordering | ~ [INF, v8] | ✔ | ✔ | ? | ? |
| Own-webshop / direct ordering (commission-free) | ~ | ✔ (Storefront) | ✔ (webshop) | ✘ | ✘ |
| Virtual brands / multiple storefronts | ~ (limited) | ✔ | ✔ | ✔ | ✔ |
| Tablet + printer hardware | ~ (store app + printer) | ✔ | ✔ | ✔ | ✔ |

---

# Actor 3 — Rider / Courier

## Onboarding, documents, and approval
DoorDash, Uber, Deliveroo, and Just Eat all run self-service web/in-app signup with **ID + vehicle + background checks** and in-app payout setup; **StackFood ships a far thinner deliveryman onboarding** — admin-created or self-registered account, online/offline, with a **"freelance" vs salaried distinction** and no built-in background-check or document pipeline ([StackFood App Store](https://apps.apple.com/mx/app/stackfood-delivery/id6443522580); [6amTech docs](https://docs.6amtech.com/docs-stack-food/intro)). DoorDash requires 18+, driver's licence, auto insurance, SSN for background check (criminal + motor-vehicle report), with weekly direct deposit or Crimson/Fast Pay and a mailed activation kit (Red Card, bag) ([DoorDash signup](https://help.doordash.com/en-us/dashers/article/dasher-signup-process)). Just Eat UK requires 18+, smartphone, licensed+insured vehicle, and a criminal + right-to-work check (~15 min) ([Just Eat Couriers](https://couriers.just-eat.co.uk/)); Uber Eats added **in-person ID verification** (Amsterdam, Apr 2024) ([Uber blog](https://www.uber.com/en-NL/blog/amsterdam/uber-eats-in-person-id-checks)). The StackFood deliveryman app is **Flutter Android-only** (vendor advises against iOS as it fully depends on location) ([CodeCanyon](https://codecanyon.net/search/stackfood)).

**StackFood gap:** no confirmed in-app self-registration/document-upload/selfie/background-check/banking-setup/training flow — likely admin-created accounts; confirm in blocked docs.

## Availability, shifts, and dispatch
**Deliveroo is the scheduling-heavy outlier** (Free Login zones vs booked sessions via the **Planner**, zone-locked, bookings open Mondays 3pm for the next week) ([Deliveroo IT](https://riders.deliveroo.it/en/first-order); [Deliveroo applicants](https://riders.deliveroo.it/en/applicants)). DoorDash blends **Dash Now + scheduled slots** ([Dasher guide](https://dasher.doordash.com/en-us/blog/how-to-use-dasher-app)); Uber is free-online-anytime with **busy-area heatmaps + Destination Mode** (only trips toward your destination) ([Uber driver app](https://www.uber.com/us/en/deliver/driver-app/); [Uber fall 25](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25)); Just Eat uses weekly run requests + add-shift ([Just Eat](https://couriers.just-eat.co.uk/)). **StackFood** offers a simple online/offline toggle with zone-based nearest-order selection; the whole system is zone-based and admin draws coverage + views live driver locations ([StackFood App Store](https://apps.apple.com/mx/app/stackfood-delivery/id6443522580)).

## Job/order flow and proof of delivery
All platforms share the accept/reject → navigate → confirm pickup → confirm delivery loop; divergence is in proof-of-delivery, batching, and merchant-paid pickups. **Uber Eats** uses a **4-digit PIN for hand-to-customer** orders and a **door photo for Leave-at-Door** ([Financial Panther](https://financialpanther.com/uber-eats-pin/); [TechCrunch](https://techcrunch.com/2023/01/27/uber-eats-now-shows-how-much-information-shared-delivery-people/)), plus a redesigned 2025 offer card with a longer window and extra-stops info ([Uber fall 25](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25)). **DoorDash** supports batched/stacked orders and a **Red Card** for pay-at-counter orders ([Dasher guide](https://dasher.doordash.com/en-us/blog/how-to-use-dasher-app); [DoorDash](https://about.doordash.com/en-us/news/dasher-earning-product-announcement)). **StackFood** adds a v7.2 **"Pickup & Delivery Location" view** and admin-toggled **Delivery Verification** (photo after delivery, visible to admin/restaurant/driver/customer, v7.1), with can't-complete handled via admin **Order Re-assign** ([6amtech v7.2](https://6amtech.com/?p=25418); [6amtech v7.1](https://6amtech.com/blog/stackfood-v7-1/)).

| Rider job-flow feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Accept/reject offer with info | ✔ (nearest-order) | ✔ | ✔ | ✔ | ✔ |
| Offer timer + earnings shown on offer | ✘ | ✔ | ✔ | ✔ (fee shown) | ~ |
| In-app navigation / map handoff | ~ (location view) | ✔ | ✔ | ✔ | ✔ |
| Batched / stacked orders | ✘ | ✔ | ✔ (extra stops) | ~ | ~ |
| Photo proof of delivery | ✔ (admin-toggle) | ✔ | ✔ (Leave-at-Door) | ~ | ~ |
| PIN/OTP delivery confirmation | ✘ (OTP is customer-login only) | ~ | ✔ (hand-to-customer) | ~ | ~ |
| Merchant pay-at-counter card | ✘ | ✔ (Red Card) | ✘ | ✘ | ✘ |
| Masked call/chat with customer/restaurant | ~ (unconfirmed) | ✔ | ✔ | ✔ | ✔ |
| Failed-delivery / can't-find-customer flow | ✘ (admin re-assign) | ✔ | ✔ | ✔ | ✔ |

## Earnings & payments (rider side)
Uber and DoorDash expose rich **per-offer earnings breakdowns + instant cash-out + quests/boosts**; Deliveroo shows per-order fee + tips with daily cash-out; **StackFood's money model centers on cash-collection remittance, not consumer-grade payout**. DoorDash offers **Earn by Time** (hourly guarantee + 100% tips) vs **Earn per Offer**, **Fast Pay** daily cash-out, and DasherDirect/Crimson ([DoorDash](https://about.doordash.com/en-us/news/dasher-earning-product-announcement)). Uber shows weekly earnings + **Instant Pay**, with **Quest/Boost+** incentives ([Uber driver app](https://www.uber.com/us/en/deliver/driver-app/); [Uber fall 25](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25)). Deliveroo pays per-order fee + tips with **daily in-app cash-out** ([Lexham](https://www.lexhaminsurance.co.uk/blog/how-much-do-deliveroo-riders-make/)); Just Eat pays per delivery with **weekly bank deposits** ([Just Eat](https://couriers.just-eat.co.uk/)).

**StackFood** confirms a freelance **earning balance**, drivers **"Pay Dues Digitally"** to admin, and v7.2 **"Cash in Hand Overflow"** (cap on collected cash before remittance), with an admin-configurable delivery-man commission ([StackFood App Store](https://apps.apple.com/mx/app/stackfood-delivery/id6443522580); [6amtech v7.2](https://6amtech.com/?p=25418); [CodeCanyon](https://codecanyon.net/comments/31708940)).

| Rider earnings feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Per-order earnings breakdown (base+tip+promo+distance) | ✘ (aggregate balance) | ✔ | ✔ | ~ | ~ |
| Instant / fast cash-out | ✘ | ✔ (Fast Pay/Crimson) | ✔ (Instant Pay) | ✔ (daily) | ✘ (weekly) |
| **COD collection + remittance** | **✔ (standout)** | ✘ | ✘ | ✘ | ✘ |
| Incentives / quests / bonuses | ✘ | ✔ | ✔ | ✔ (zone bonuses) | ~ |
| Driver-side bank withdrawal flow | ✘ (drivers pay dues TO admin) | ✔ | ✔ | ✔ | ✔ |

**StackFood call-out:** **COD collection + "Cash in Hand" remittance is a genuine StackFood advantage** for COD-heavy markets, but StackFood has **no per-offer earnings breakdown, no instant cash-out, no incentives/quests, and no driver-to-bank withdrawal** — the digital flow is drivers paying dues TO admin, not withdrawing earnings.

## Performance tiers, support & safety
DoorDash (**Top Dasher**, acceptance/completion rates) and Uber (**Uber Pro / Uber Eats Pro**: Blue/Green→Gold→Platinum→Diamond, Gold+ earn more) expose formal performance tiers + rewards ([Dasher guide](https://dasher.doordash.com/en-us/blog/how-to-use-dasher-app); [Uber Pro](https://www.uber.com/us/en/deliver/uber-pro/); [Uber fall 25](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25)); Just Eat uses algorithmic deactivation (couriers deactivated by AI over overpayments as small as £1.35) ([BHRRC/Guardian](https://www.bhrrc.org/en/latest-news/fired-by-ai-just-eat-uk-couriers-deactivated-for-minor-overpayments/)). On safety, **DoorDash SafeDash** (with ADT: reassurance call, 911 escalation on unresponsiveness) and **Uber Safety Toolkit** ship dedicated in-app suites ([TechCrunch](https://techcrunch.com/2021/11/03/doordash-rolls-out-safedash-an-in-app-security-toolkit-for-delivery-people-on-the-platform/amp/); [DoorDash Safety](https://about.doordash.com/en-us/safety); [Uber driver app](https://www.uber.com/us/en/deliver/driver-app/)); Just Eat/Scoober offer in-app chat support ([Scoober](https://apps.apple.com/us/app/-/id964121026)). **StackFood exposes no visible performance-tier, incentive, or safety-toolkit system in the deliveryman app** [INF] — three more backlog gaps. StackFood confirms order history, real-time notifications, and multilingual support ([StackFood App Store](https://apps.apple.com/mx/app/stackfood-delivery/id6443522580)). Parcel/grocery delivery modes exist on Uber (Courier), DoorDash, and Deliveroo but **not StackFood** (restaurant-only codebase).

---

# Actor 4 — Admin / Platform-Operations

StackFood's admin is where it is strongest: a single Laravel super-admin panel (**~150 screens**, shared shell across StackFood/eFood/6amMart/GroFresh/Six Valley) that the big-4 have no public single-panel equivalent for — their back office is split into internal ops/risk tooling and merchant/courier self-serve portals. The 16 module groups below are the StackFood admin backbone; the big-4 equivalents follow.

## Dashboard & analytics
**StackFood [INF]:** status counters (Pending/Confirmed/Packaging/Out-for-Delivery/Delivered/Canceled/Refunded/Scheduled/Payment-Failed, each a clickable filtered list); earning-statistics chart (week/month/year/overall); order-statistics chart; **zone-wise dashboard filter**; commission overview (admin commission, delivery charge earned, tax collected); wallet/transaction summary; user counts (customers/restaurants/delivery men/foods); top-sellers leaderboards (Top Selling/Top Rated Foods, Top Restaurants, Top Customers); recent orders table; role-scoped widgets. 6amtech admin panels surface an order-stage graph + counters ([Webkul](https://webkul.com/blog/nodejs-food-delivery-user-guide/)); "Reporting and Statistics" is a confirmed core area ([ctit v7.6](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html)).

## Order management
StackFood has an **Advanced Order Management** module. **Confirmed:** Order Re-assign (v7.2), refund handling, scheduled orders, manual delivery-man assignment / Dispatch Management, delivery-verification photo ([6amtech v7.2](https://6amtech.com/?p=25418); [6amtech v7.1](https://6amtech.com/blog/stackfood-v7-1/); [ctit v7.6](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html)). **[INF]:** per-status filtered lists (All/Pending/Confirmed/Processing/Out-for-Delivery/Delivered/Canceled/Payment-Failed/Refund-Requested/Refunded/Scheduled/Dine-in/Offline-payment-pending); filters by zone/restaurant/date/type + export; order detail with full fee breakdown, status-change dropdown, assign/reassign, print/download invoice, collect-cash flag, add note, refund, view proof photo; offline-payment verification screen; cancellation-with-reason; limited edit-order in later versions.

## Restaurant, food, and zone management
- **Restaurant Management:** **confirmed** bulk import/export of restaurants, restaurant approval/self-registration with custom fields, disbursement to restaurants (*Business Settings > Disbursement*), free-delivery setup, role-based owner access ([6amtech v7.1](https://6amtech.com/blog/stackfood-v7-1/); [6amtech v7.2](https://6amtech.com/?p=25418)); **known limitation** — a restaurant cannot operate in multiple zones ([CodeCanyon](https://codecanyon.net/comments/31727302)). **[INF]:** restaurants list + add/edit, join-request approval, per-store settings (commission %, scheduling, delivery/takeaway toggles, GST/VAT, min order, free-delivery-over, prep time, packaging charge, POS on/off), restaurant wallet + disbursement list, reviews, recommended/featured flags.
- **Food Management:** **confirmed** bulk import/export of foods/addons/categories and per-food max-purchase-quantity (*Food Management > Foods > Add New*) ([6amtech v7.1](https://6amtech.com/blog/stackfood-v7-1/)). **[INF]:** categories/sub-categories, cuisines, attributes, add-ons, foods list + add/edit (variations, add-ons, tax, nutrition, allergen, available window, veg/non-veg, stock), food reviews, recommended/featured.
- **Zone & Geography:** **confirmed** "the whole system depends on operation zone," multiple zones with business-on/off, polygon-on-map coverage, admin-configurable extra/service/platform charge ([6amtech docs](https://docs.6amtech.com/docs-stack-food/intro); [6amtech](https://6amtech.com/?p=25418)); **known limitation** — no per-zone order shut-off ([CodeCanyon](https://codecanyon.net/comments/31749539)). **[INF]:** per-zone delivery fee (min charge, per-km, max fee), per-zone extra charge + tax. StackFood is single-module (food); 6amMart siblings add a Modules screen (Food/Grocery/Pharmacy/Shop/Parcel).

## Delivery-man, customer, promotion & subscription management
- **Delivery-man Management:** **confirmed** deliveryman business settings + delivery-verification (*Business Setup > Deliveryman*), disbursement to deliverymen, manual assignment ([6amtech v7.1](https://6amtech.com/blog/stackfood-v7-1/); [6amtech v7.2](https://6amtech.com/?p=25418)). **[INF]:** list + add/edit (zone, vehicle, identity type/number, ID image, account info), join-request approval, vehicle categories (per-km surcharge), deliveryman wallet (balance, cash-in-hand, payable), disbursement report, reviews, emergency contacts, self-registration with custom fields.
- **Customer Management:** **confirmed** customer loyalty points and configurable loyalty/coupons ([6amtech](https://6amtech.com/blog/stackfood-vs-efood/); [zoftwarehub](https://zoftwarehub.com/en-ae/products/stackfood/zoftware-analysis)). **[INF]:** customers list + add + detail (orders, wallet, addresses), wallet add/deduct + bonus setup, loyalty-point config (earning rate, conversion, min points), customer settings (wallet/loyalty/referral/add-fund toggles), subscribed-emails list, referral config.
- **Promotion & Marketing:** **confirmed** "Marketing Section" module, configurable campaigns/coupons/loyalty, and an ecosystem Advertisement feature ([ctit v7.6](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html); [zoftwarehub](https://zoftwarehub.com/en-ae/products/stackfood/zoftware-analysis); [6amtech](https://6amtech.com/?p=26085)). **[INF]:** campaigns (basic + item), banners, coupons (default/free-delivery/first-order/restaurant-wise + limits + zone), push-notification composer (target customer/deliveryman/restaurant/zone), cashback setup, advertisements (approve restaurant-submitted), flash sale (later versions).
- **Subscriptions & Engagement:** **confirmed** subscription models as an optional feature ([zoftwarehub](https://zoftwarehub.com/en-ae/products/stackfood/zoftware-analysis)). **[INF]:** restaurant subscription packages (name, price, duration, feature limits: max orders/products, POS/chat/review/self-delivery/app access), assign/renew, subscription transaction report, business-model toggle (commission/subscription/both); customer food-subscription (recurring orders).

## Transactions, settings, 3rd-party, CMS, system & roles
- **Transactions & Reports:** **confirmed** disbursement feature + UI/report, "Accounts Section" ([6amtech v7.2](https://6amtech.com/?p=25418); [6amtech disbursement](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/); [ctit v7.6](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html)). **[INF]:** transaction/order/food/restaurant/deliveryman/expense/tax reports, disbursement reports, **collect-cash reconciliation** (collect from deliveryman/restaurant, cash-in-hand ledger), wallet-transaction report.
- **Business Settings:** **confirmed** *Business Setup > Business Settings* hub (extra/service charge), deliveryman settings, disbursement settings, free-delivery + custom self-registration fields ([6amtech v7.1](https://6amtech.com/blog/stackfood-v7-1/); [6amtech v7.2](https://6amtech.com/?p=25418)). **[INF]:** general setup (currency/timezone/time-format/decimals), order settings (scheduling, delivery/takeaway/dine-in toggles, confirmation model, min order, tips, delivery-verification OTP, instant order), refund settings, customer/deliveryman/restaurant settings, delivery-fee settings, maintenance mode, order-cancellation reasons, business-model toggle.
- **3rd-Party Configuration:** **confirmed** offline-payments toggle, payment gateways (COD/SSLCOMMERZ/Razorpay/PayPal/Stripe/Paystack/SenangPay/Flutterwave/MercadoPago/bKash…), SMS gateway for OTP, **35+ payment & 14+ SMS gateways via a paid add-on** ($79/$299, zip-upload + license), SMTP mail, Firebase push config ([6amtech mandatory-setup](https://docs.6amtech.com/docs-six-valley/admin-panel/mandatory-setup); [6amtech add-on](https://6amtech.com/payment-sms-gateway-addon/); [6amtech Firebase](https://docs.6amtech.com/docs-six-cash/admin-panel/mandatory-setup)). **[INF]:** Google Maps key, social login config, analytics config; **reCAPTCHA unverified**.
- **Content/CMS:** **[INF]** landing-page builder, legal pages (terms/privacy/about/refund/cancellation/shipping), FAQ, social links, app settings (store URLs, force-update, maintenance), languages/translations editor, fonts, theme/colors, logos/favicon. A React web front-end is confirmed + branded from admin ([6amtech](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)).
- **System Administration:** **confirmed** add-on/module management (zip + license), license activation, cron setup ([6amtech add-on](https://6amtech.com/payment-sms-gateway-addon/); [CodeCanyon](https://codecanyon.net/comments/31749539); [6amtech mandatory-setup](https://docs.6amtech.com/docs-six-valley/admin-panel/mandatory-setup)). **[INF]:** database backup, software/version/update, clean/clear-data.
- **Employee / Role & Permission:** **confirmed** role-based access + "Employee Section" ([6amtech docs](https://docs.6amtech.com/docs-stack-food/intro); [ctit v7.6](https://www.ctit.ufmg.br/wp-content/woo/stackfood-multi-restaurant-7-6-food-delivery-app-with-laravel-admin-and-restaurant-panel.html)). **[INF]:** roles with module-level permission grid, employees/admins list + add/edit + role/zone scope, left-nav gating per role.

## Big-4 platform-ops equivalents
The big-4 have **no single super-admin panel**; back office splits into (a) internal ops/risk tooling and (b) merchant/courier self-serve portals. **DoorDash** runs a dedicated Risk/Fraud Operations team (manual review + rules engine + Sift Payment Protection) and a Merchant Services Escalations team, with a 14-day merchant chargeback-dispute window ([Sift case study](https://pages.sift.com/rs/526-PCC-974/images/Sift_CaseStudy_Doordash_062823.pdf); [Merchant Services role](https://www.themuse.com/jobs/doordash/merchant-services-escalations-specialist); [conductatlas](https://conductatlas.com/platform/doordash/doordash-terms-of-service/prohibition-on-fraudulent-chargebacks/)). Common internal-ops domains across all four: **fraud/abuse detection + manual-review queues, payment-dispute/chargeback handling, refund/credit adjudication, merchant onboarding/activation + menu QA, courier ops (onboarding/deactivation/background checks/dispatch/payout disputes), market/zone + surge-pricing management, pricing/promo/ad-product ops, catalog ingestion, and support/CRM case tooling** — a capability map StackFood's single panel must cover piecemeal across its modules. Merchant self-serve analogues to the StackFood restaurant panel are **DoorDash Merchant Portal/Business Manager, Uber Eats Manager, Deliveroo Partner Hub, and Just Eat Partner Hub** ([Just Eat](https://www.just-eat.ie/partner-blog/?p=1352); [Deliveroo](https://help.deliveroo.com/en/articles/3524899-managing-your-deliveroo-menu-in-partner-hub)).

---

# Consolidated cross-actor feature superset → epic/story backlog

The superset below merges all four actors into build epics. **Each epic notes whether StackFood already has it (ship-and-verify) or lacks it (net-new build).** Items tagged [INF] need source-verification against the live StackFood codebase before estimation.

### A. Have-and-verify epics (StackFood already ships; confirm against source)
| Epic | Representative stories | StackFood | Big-4 parity |
|---|---|---|---|
| Accounts & multi-address | OTP/social/guest login, saved map-pinned addresses, dark mode, i18n/RTL | ~ [INF] | High |
| Zone-based geography | polygon zones, per-zone fees, business on/off | ✔ | n/a (platform-managed) |
| Order lifecycle + live tracking | status steps, map ETA, chat/call, reorder, cancel-with-reason, refund-request | ~ [INF] | High |
| Dual order-confirmation models | restaurant-first / deliveryman-first / instant-order | ✔ | Low (unique framing) |
| COD + wallet + partial payment | COD, in-app wallet, add-fund/bonus, partial pay, offline payment | ✔ | Low (StackFood edge) |
| Pluggable multi-gateway + mobile money | 35+ gateways, 14+ SMS, add-on install | ✔ | Low (StackFood edge) |
| Built-in POS + self/platform delivery | POS screen, self-delivery toggle, pickup, dine-in | ✔ / ~ [INF] | Partner-POS elsewhere |
| Menu catalog | categories, variations, add-ons, veg/allergen text, item scheduling, bulk import/export | ~ [INF] / ✔ | High |
| Merchant order board + re-assign | status tabs, accept/reject, prep time, handover, order re-assign | ~ [INF] / ✔ | High |
| Admin super-panel (~150 screens) | dashboard, order/restaurant/food/zone/DM/customer mgmt, reports, settings, 3rd-party, CMS, roles | ~ [INF] / ✔ | Split ops+portal |
| Disbursement + cash reconciliation | collect-cash ledger, pay dues digitally, cash-in-hand overflow, disbursement reports | ✔ | Partial |
| Coupons/campaigns/cashback/referral/loyalty-points | admin-configured promos, referral→wallet | ✔ / ~ [INF] | High |
| Photo proof-of-delivery | admin-toggled delivery verification photo | ✔ | Partial |

### B. Net-new build epics (StackFood lacks; big-4 differentiators — prioritized)
| Priority | Epic | Source platforms to model | Why it matters |
|---|---|---|---|
| ✅ P0 | **Paid subscription membership** (free delivery + perks + late-credit) — **BUILT** (Tunakula Plus: admin plans, customer subscribe/cancel, quote+checkout benefit, platform-funded settlement that stays balanced) | DashPass, Uber One, Deliveroo Plus/Diamond | Biggest customer-retention gap |
| ✅ P0 | **Group ordering + bill-split** (shared cart link, deadline, auto/manual checkout) — **BUILT** (server-side shared cart, invite code/link, per-member items, host lock + place as one order, per-person split that sums to the total to the cent) | Uber Eats, DoorDash | Flagship social-order feature |
| ✅ P0 | **Rich dietary/allergen filtering + structured nutrition/calorie** — **BUILT** (validated dietary tags + EU-14 allergens + per-serving nutrition on each dish; merchant editor, API validation, storefront badges + diet chip filter) | Uber Eats, Deliveroo, Just Eat (14 EU allergens) | Compliance (UK/EU) + accessibility |
| ✅ P1 | **Driver performance tiers + incentives/quests** (Top Dasher, Uber Pro, Boost) — **BUILT** (Bronze/Silver/Gold/Platinum tiers from lifetime deliveries + 30-day acceptance, shown with next-tier progress; admin-defined quests "N deliveries in a window for a bonus", rider progress bars + claim that credits a balanced, idempotent bonus into the cashable balance) | DoorDash, Uber | Courier supply retention |
| ✅ P1 | **Driver safety toolkit / SOS** (reassurance call, 911 escalation, trip-share) — **BUILT** (in-app SOS with kind + location → an ops safety queue on the dispatch board with acknowledge/resolve and a map link; audited) | DoorDash SafeDash, Uber Safety Toolkit | Courier safety + liability |
| ✅ P1 | **Instant/fast driver cash-out + per-offer earnings breakdown** — **BUILT** (per-delivery base+tip breakdown; instant cash-out of the earned balance to mobile money, balanced idempotent ledger journal) | DoorDash Fast Pay, Uber Instant Pay | Courier supply, earnings transparency |
| P1 | **Self-service courier onboarding + KYC/background check + document upload** | DoorDash, Uber, Just Eat | Scale onboarding without admin labor |
| ✅ P1 | **Merchant performance scorecards + deep analytics** (acceptance rate, ops heatmap, customer cohorts) — **BUILT** (per-restaurant 0–100 score from acceptance, fulfilment and prep speed; orders/delivered/cancelled, acceptance/fulfilment/cancellation rates, avg prep minutes, GMV; window selector; scoped to the branches the viewer can see) | Uber Top Eats, Just Eat Performance Score, Deliveroo Hub | Merchant self-optimization |
| P2 | **Scheduled shifts / Planner + busy-area heatmaps** for riders | Deliveroo Planner, Uber heatmaps, DoorDash slots | Supply/demand balancing |
| P2 | **Batched/stacked orders + merchant pay-at-counter card** | DoorDash, Uber extra-stops | Delivery efficiency |
| P2 | **Merchant self-serve ads/sponsored placement + BOGO/happy-hour builder** | DoorDash Sponsored, Just Eat Promoted, Deliveroo Marketer | Merchant revenue, platform take-rate |
| P2 | **PIN/OTP delivery confirmation for driver** (hand-to-customer) | Uber Eats PIN | Delivery integrity/anti-fraud |
| P2 | **Order throttling / busy-mode + special/holiday hours** | all big-4 | Merchant ops during peaks |
| P3 | **Grocery/convenience vertical + parcel delivery mode** | DoorDash, Uber, Deliveroo, Takeaway | Basket expansion (6amMart covers separately) |
| P3 | **Alcohol/age-verification flow** (ID scan, 18+ gates) | Deliveroo | Regulated-goods expansion |
| P3 | **Gift cards + corporate/business accounts** | DoorDash, Uber for Business | B2B + gifting revenue |
| P3 | **Per-zone order shut-off + multi-zone restaurants** (fix known StackFood limits) | — (StackFood defect) | Operational flexibility |
| P3 | **Internal fraud/risk + chargeback-dispute ops tooling** | DoorDash Risk Ops | Platform integrity at scale |

### Items to verify before committing (sourcing caveat carried forward)
Every StackFood row tagged **[INF]** above — notably the customer login/OTP matrix, home/discovery modules, cart/fee breakdown, loyalty mechanics, the full restaurant/food/report screen trees, the deliveryman app's exact capabilities, and the ~150-screen admin enumeration — is **product-knowledge inference, not source-confirmed**, because `docs.6amtech.com`, `preview.6amtech.com`, `6amtech.com`, CodeCanyon, and the App Store listings were egress-blocked. Validate these against the live `user_app`/`store_app`/`delivery` Flutter source, the Laravel `restaurant_panel` and admin, and the current CodeCanyon v8 listing before sizing. Confirmed items carry inline citations; CodeCanyon buyer comments are user-reported pain points (notification sound bug, bank re-entry on withdrawal, no per-zone disable), not vendor specs.

## Conclusion
The competitive picture resolves into a clean build thesis: **StackFood is a strong, COD-and-emerging-market-native foundation whose breadth is real but whose depth lags the big-4 in exactly the places that drive retention and supply** — membership, social ordering, dietary compliance, courier incentives/safety, and merchant self-optimization. A StackFood-benchmarked rebuild should therefore treat Section A as "port and harden" (the plumbing — zones, wallets, disbursement, dual confirmation models, multi-gateway payments, built-in POS — is genuinely differentiated and worth preserving) and Section B as the roadmap, sequenced so the three P0 epics (subscription membership, group ordering, dietary/allergen+nutrition) land first because they are simultaneously the widest competitive gaps and, in the UK/EU, partly regulatory table stakes. The sharpest strategic insight is that StackFood's and the big-4's strengths are nearly complementary: StackFood optimizes for operators who collect cash, run their own POS, and manage couriers manually, while the big-4 optimize for scaled, cashless, gig-supply marketplaces — so the highest-leverage product decision is not "catch up to DoorDash" but "keep StackFood's cash/POS/zone backbone while grafting on the big-4's retention, supply-incentive, and compliance layers," with the explicit understanding that roughly half the StackFood baseline documented here still needs source-verification against the live codebase before it is treated as built.
