# Customer-Facing Feature Set: StackFood, DoorDash, Uber Eats, Deliveroo, Just Eat

> Scope note: This is a build-backlog inventory of concrete customer (eater) features across mobile apps + web, current to 2026, aiming at the global superset. StackFood is the primary benchmark (open/commercial Laravel+Flutter codebase).
>
> **Sourcing caveat:** The StackFood vendor properties (6amtech.com, preview.6amtech.com, apps.apple.com, codecanyon.net, and nulled-mirror pages) were all blocked by the network egress proxy during research, so most StackFood feature detail below is drawn from the researcher's prior knowledge of the 6amTech StackFood product (v7.x–v8.x user_app) and is marked as **Inference** rather than cited. The few StackFood facts that came through web search (referral wallet, partial payment, guest checkout, scheduled orders, free delivery, online cart sync, offline payment) are cited. These should be verified against the live CodeCanyon listing / 6amTech changelog and the `user_app` Flutter source before being treated as confirmed.

## Onboarding & Account (sign-up/in, profile, addresses, payment-on-file, language, dark mode)

### Takeaway
All five support account creation with saved addresses, saved payment methods, and order history; social/Apple/Google login is common; guest checkout exists on StackFood, Just Eat and others; language selection + dark mode are StackFood-specific configurables.

### Cited Findings
- **StackFood — guest checkout, scheduled orders, free-delivery option, online cart sync, offline/manual payment** were all shipped in the v7.2 release list. — [6amtech blog (v7.2 / React website 2.3)](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)
- **Just Eat / Takeaway — account stores saved addresses for future orders, past orders, ratings/reviews; saved card details for faster re-ordering; social login + mobile verification codes** (last item from a clone-vendor blog, lower confidence). — [Miracuves JustEat features](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md); [Just Eat 2013 saved cards](https://internetretailing.net/?p=32439)
- **Uber Eats — guests do not need an Uber account to join a host-paid group order.** — [Uber Eats group ordering](https://www.uber.com/business/solutions/eats/group-ordering/)
- **Just Eat / Takeaway — payment options at signup: debit/credit card, cash, Apple Pay (Just Eat); credit card or PayPal (Takeaway.com).** — [Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)

### Inferences (StackFood user_app, from product knowledge — verify)
- Sign-in methods: **phone number + SMS OTP**, email/password, Google social login, Facebook login, and Apple Sign-In (Apple sign-in required for iOS build). Admin can toggle which login methods are enabled, and toggle phone-OTP vs email-OTP verification.
- **Guest checkout / guest mode** (browse + order without account) toggleable by admin.
- Profile screen: name, email, phone (with verification), profile image.
- **Multiple saved addresses** with address type (home/office/other), map-pin placement + reverse-geocoded address, floor/house/road/contact-person fields.
- **Saved payment methods / cards on file** (via gateway tokenization where supported).
- **Language selection** (multi-language, admin-defined languages; RTL support e.g. Arabic) and **dark mode / theme toggle** in app settings.
- Account deletion request, logout, notification preferences.

### Gaps
- Exact current StackFood v8 login-method matrix and whether Apple login is default-on could not be confirmed (vendor pages blocked).

---

## Discovery (home layout, search, filters, sorting, map, list cards)

### Takeaway
Rich home surfaces (banners, categories/cuisines, popular/nearby/new/promoted collections) plus filter + sort are universal. Uber Eats and Deliveroo lead on dietary/allergy filters; StackFood exposes veg/non-veg filtering and category/cuisine browsing.

### Cited Findings
- **Uber Eats — allergy-friendly / dietary filters** since 2019 (dedicated "Allergy" section, filter restaurants by dietary preference); also **filters for delivery speed, dietary concerns, and price**, plus tailored recommendations surfacing most-used restaurants at top of home. — [Uber newsroom (accessibility)](https://www.uber.com/newsroom/making-food-delivery-more-accessible-sustainable); [MobileSyrup 2019](https://mobilesyrup.com/2019/11/25/uber-eats-allergy-friendly-filter/); [TechCrunch 2017](https://techcrunch.com/2017/04/18/ubereats-gets-custom-suggestions-food-filters-and-drop-off-instructions)
- **Just Eat / Takeaway — map view of restaurant locations; browse-by category incl. "groceries" vertical (baby food, flowers, beer, wine, staples) in Takeaway markets.** — [Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)
- **DoorDash — restaurant discovery across a wide variety of foods/restaurants** (reviewer-reported). — [GetApp DoorDash reviews](https://www.getapp.com/retail-consumer-services-software/a/doordash/reviews/)

### Inferences (StackFood — verify)
- Home layout modules: top **search bar**, **promotional banners/sliders**, **category icons** (cuisine/food categories), **popular foods**, **popular/most-reviewed restaurants**, **nearby restaurants**, **new/recently added restaurants**, **"Order again"** row, **campaigns** (basic + item campaigns), **discounted/offer items**, **"Best reviewed items."**
- Location picker at top (current GPS location or saved address) driving the zone-based restaurant list.
- **Search** with recent searches + suggestions; **filters**: veg/non-veg, category, rating, (and sort by: top rated, nearest, discount/offer); product-level and restaurant-level search.
- Restaurant list **cards** show: name, logo/cover image, cuisine/category tags, **average rating + review count**, **distance**, **estimated delivery time**, **delivery fee / free-delivery badge**, **minimum order**, open/closed status, discount badge, favorite (heart) toggle.
- Cuisine browsing screen; "All restaurants" list with filter/sort.

### Gaps
- StackFood does not expose the deep dietary/halal filter set that Uber Eats/Deliveroo have (veg/non-veg flag is the main dietary toggle) — not independently confirmed from a live source this session.
- Deliveroo's exact home/collection modules (e.g., "Picked for you," offers rail) not captured from an official page this session.

---

## Restaurant / Store Page (menu, item detail, variations, add-ons, notes, flags, availability, hours)

### Takeaway
Menu-category browsing, item detail with variations + add-on modifiers, special-instruction notes, veg flags, sold-out/availability, and opening-hours scheduling are common. StackFood supports food variations, add-ons, item schedules and veg/non-veg flags.

### Cited Findings
- **Uber Eats — flag allergies on a specific dish; restaurant can message back if it can't accommodate and suggest an alternative.** — [Uber newsroom](https://www.uber.com/newsroom/making-food-delivery-more-accessible-sustainable)
- **Deliveroo — age-restricted items (alcohol) must be tagged on the menu**; menu pages may show feedback Deliveroo shares with other users. — [Deliveroo partner hub: age-restricted items](https://help.deliveroo.com/en/articles/4775074-managing-age-restricted-items-in-partner-hub)

### Inferences (StackFood — verify)
- Restaurant page: cover image, logo, rating, delivery time/fee/min-order header, **search within menu**, menu organized by **food categories**, **"Recommended" / popular items**, **veg/non-veg filter toggle** on the menu.
- Item detail (bottom sheet / page): image, description, price, **variations** (single/multi-select variation groups with price deltas), **add-ons** (optional paid extras with quantity), **quantity stepper**, **special-instruction / item-note** free-text field, **veg indicator**.
- **Product/food schedule** (item available only during set time windows), **sold-out / out-of-stock** state, restaurant **open/closed by schedule** (per-day opening hours) with pre-order when closed.
- **Nutrition/allergen info**: minimal in StackFood (no structured allergen DB by default) vs rich on Uber Eats/Deliveroo.
- Favorite item toggle; share restaurant/item.

### Gaps
- Structured nutrition/calorie display (mandated in some UK/EU menus) — StackFood support unconfirmed; Deliveroo/Just Eat/Uber Eats show calorie info in applicable regions but not captured from an official page this session.

---

## Cart & Checkout (order types, cart editing, tips, instructions, fees breakdown)

### Takeaway
Delivery + pickup/takeaway are universal; **dine-in** and **scheduled/pre-order** appear on StackFood; **group order** is a flagship on Uber Eats (and DoorDash). Fee breakdowns (delivery, service, small-order, tax) and tipping are standard; cutlery opt-out and contactless are platform-specific.

### Cited Findings
- **StackFood — scheduled orders for customers; free-delivery option; online cart sync (cart persists across devices/login).** — [6amtech blog](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)
- **DoorDash — ordering options incl. pickup and scheduled deliveries; group orders; contactless delivery.** — [Appello DoorDash roundup](https://appello.com.au/articles/how-to-create-an-app-lke-doordash)
- **DoorDash pickup — customer places pickup order, pays online, sees status + estimated pickup time, tells staff they're picking up a DoorDash order; can tip on pickup orders.** — [DoorDash Help: Order Pickup](https://help.doordash.com/en-ca/merchants/article/order-pickup)
- **Uber Eats group order — host starts shared cart + sends link; set checkout deadline up to 7 days ahead; options: no deadline + manual checkout, deadline + auto-checkout, or deadline + manual checkout; large orders (15+ people) must be scheduled ≥24h ahead; reminder notifications on deadline.** — [Uber AU blog: split your order](https://www.uber.com/en-AU/blog/split-your-uber-eats-order-with-the-team/); [Restaurant Dive](https://www.restaurantdive.com/news/uber-eats-brings-back-group-ordering-with-enhanced-features/620068/)
- **Uber Eats — schedule orders ahead of time; drop-off instructions.** — [TechCrunch 2017](https://techcrunch.com/2017/04/18/ubereats-gets-custom-suggestions-food-filters-and-drop-off-instructions)
- **Just Eat / Takeaway — pre-ordering before a restaurant opens.** — [Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)

### Inferences (StackFood — verify)
- **Order types**: Delivery, **Takeaway/Pickup**, and **Dine-in** (dine-in was added in later v8.x; it lets a customer order for on-premise dining, sometimes via table/QR). Scheduled/pre-order date-time picker per order.
- Cart screen: edit quantities, remove items, add item notes, see subtotal; **delivery instructions / note to rider**; **cutlery / "add cutlery" toggle** (region-dependent; not core StackFood).
- Address selection + **delivery-time selection** (now vs schedule).
- **Fee breakdown**: item subtotal, **delivery fee** (distance-based or free), **discount/coupon**, **VAT/tax**, **additional/service charge**, **tips to delivery man** (tip entered at checkout). Minimum-order enforcement.
- **Tip at checkout** for delivery man (preset + custom).

### Gaps
- StackFood "group order" support: not evidenced — appears **absent** in standard StackFood (confirm). Group order is a strong Uber Eats / DoorDash differentiator.
- Contactless-delivery toggle and cutlery opt-out exact presence per platform in 2026 not confirmed from official pages this session.

---

## Payments (COD, cards, mobile money, wallet, split, Apple/Google Pay, PayPal, promo)

### Takeaway
StackFood is the most gateway-flexible (COD, dozens of pluggable gateways, in-app wallet, partial/split payment, offline payment). DoorDash/Uber Eats/Deliveroo rely on cards + Apple/Google Pay + PayPal + their own credit/wallets; cash is largely absent in Western markets.

### Cited Findings
- **StackFood — Partial Payment: pay part of an order from in-app wallet balance and the remainder via COD and/or digital payment** (e.g., $30 wallet + $70 card on a $100 order). — [6amtech blog / v7.2](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)
- **StackFood — offline/manual payment** (customer pays via external method, admin verifies); **cash on delivery, credit cards, online wallets.** — [6amtech blog](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/); [6amTech vendor description via search](https://6amtech.com/blog/stackfood-vs-efood/)
- **Just Eat / Takeaway — Apple Pay, debit/credit card, cash (Just Eat); credit card or PayPal (Takeaway).** — [Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)
- **Uber Eats (Capital One) and card-linked offers exist**; Uber One gives credits usable toward orders. — [Uber Eats Capital One](https://www.ubereats.com/capitalone)

### Inferences (StackFood — verify)
- **Cash on Delivery (COD)** toggle per zone/restaurant.
- **Digital gateways** (pluggable, admin-enabled): Stripe, PayPal, Razorpay, Paystack, Flutterwave, SSLCommerz, Senangpay, Paymob, bKash, and others via 6amTech's payment-gateway add-on — supporting cards, **mobile money** (Africa/Asia), and local wallets.
- **In-app wallet**: top-up/add-fund, wallet balance, wallet transaction history, pay from wallet, **partial payment** (cited above), wallet bonus on add-fund.
- Apple Pay / Google Pay via Stripe where configured.
- Promo/coupon application field at checkout.

### Gaps
- Whether StackFood natively supports native Apple Pay / Google Pay sheets (vs card entry) depends on gateway config — unconfirmed.
- Split-payment-between-people (vs single-user partial payment) is **not** a StackFood feature; Uber Eats offers bill-splitting within group orders (see cited group-order findings).

---

## Promotions (coupons, cashback, loyalty, referral, subscriptions, campaigns, first-order, stamp cards)

### Takeaway
StackFood bundles coupons, cashback, in-wallet loyalty, referral, and campaigns natively. The big-4 run membership subscriptions — **DashPass, Uber One, Deliveroo Plus, Just Eat equivalents** — plus coupons and (Just Eat) **Stamp Cards** loyalty.

### Cited Findings
- **StackFood — referral program**: invite a contact and receive **referral points credited to wallet** (after invitee logs in/registers). — [6amtech blog](https://6amtech.com/blog/new-payment-disbursement-system-and-ui-for-react-website/)
- **Just Eat — Stamp Cards loyalty**: earn 1 stamp per order (each worth 10% of the order excl. fees), after 5 stamps the 6th order gets an auto-applied discount; rewards are restaurant-specific. — [Just Eat Extra Helpings: Stamp Cards](https://extrahelpings.just-eat.ie/stampcards)
- **DoorDash DashPass** (~$9.99/mo or discounted annual): $0 delivery fee on eligible orders meeting a minimum subtotal + reduced service fees; also exclusive deals. — [Kudos DashPass vs Uber One](https://www.joinkudos.com/blog/doordash-dashpass-vs-uber-one-which-saves-more); [Appello roundup](https://appello.com.au/articles/how-to-create-an-app-lke-doordash)
- **Uber One** ($9.99/mo or $96/yr): $0 Delivery Fee on eligible Eats orders (incl. grocery), 6% Uber One credits on eligible rides; 2025 additions: Surge Savings, 30% off select fresh items Tuesdays (limited time), 10% Lime credits; Member Days events. — [Uber blog: new Uber One benefits 2025](https://www.uber.com/blog/new-benefits-for-uber-one-members-2025); [SmallBizTrends](https://smallbiztrends.com/uber-launches-new-everyday-savings-features-2025/)
- **Deliveroo Plus**: core perk is free delivery on orders from any participating restaurant/grocer + members-only deals; markets/pricing vary (UK original £8.99/mo or £89/yr; SG 30-day trial). **Plus Diamond** (UK 2024, £19.99/mo): priority delivery, full-value credit back if >10 min late, 10% credit refund on orders over £30. Plus also offered for companies/employees. — [Expat Living SG](https://expatliving.sg/food-delivery-apps-singapore-deliveroo-plus); [City AM](https://www.cityam.com/deliveroos-testing-amazon-prime-style-delivery-subscription/); [Verdict Foodservice: Plus Diamond](https://www.verdictfoodservice.com/newsletters/deliveroo-plus-diamond-subscription-service)

### Inferences (StackFood — verify)
- **Coupons/promo codes**: percentage or fixed, first-order coupons, per-user limits, min-spend; applied at checkout.
- **Cashback / loyalty points**: order-based loyalty points that **convert to wallet balance**; admin-configured earning rules. (StackFood markets a loyalty-point system credited to the wallet.)
- **Campaigns**: basic campaigns (restaurant-wide time-boxed promos) and item/food campaigns surfaced on home.
- Referral code share (cited); first-order / new-user offers via coupon config.
- **No native subscription/membership** tier in standard StackFood (vs DashPass/Uber One/Plus) — a gap vs the big-4.

### Gaps
- Exact StackFood loyalty-point earning/redemption mechanics not confirmable this session (vendor pages blocked).
- Deliveroo "Plus Silver/Gold" Amazon-Prime tiers appeared only on a low-reliability aggregator (subger.com) and could not be confirmed against an official Deliveroo source — treat as unverified.
- Current (2026) exact DashPass pricing/terms not from an official DoorDash page this session.

---

## Order Lifecycle (tracking, chat/call, history, reorder, cancel, edit, refund, rate, tip-after)

### Takeaway
Live map tracking with courier + ETA, status steps, in-app chat/call, order history, and one-tap reorder are universal. StackFood provides live tracking, in-app conversation/chat (with admin/restaurant/delivery man), reorder, and rating. Cancel/refund flows differ by platform.

### Cited Findings
- **DoorDash — follow each order stage, see when ready/delivered; chat with the delivery person for updates/corrections; reorder previous deliveries; manage multiple orders.** — [GetApp DoorDash reviews](https://www.getapp.com/retail-consumer-services-software/a/doordash/reviews/)
- **DoorDash — tip before or after delivery.** — [RideshareGuy](https://therideshareguy.com/doordash-driver-app-feature-requests/)
- **Uber Eats — participants + creator can view/track group orders in progress.** — [Uber AU blog](https://www.uber.com/en-AU/blog/split-your-uber-eats-order-with-the-team/)
- **Just Eat / Takeaway — live tracker from kitchen/store to doorstep with push-notification status updates; reorder favourites from order history.** — [Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)
- **Deliveroo — cancel via order help as long as the restaurant hasn't started preparing; Deliveroo proactively calls if the order may be late; in-app Help to report problems.** — [Deliveroo IE FAQ](https://deliveroo.ie/faq); [Deliveroo help (contact)](https://help.deliveroo.com/)

### Inferences (StackFood — verify)
- **Live order tracking**: status steps (pending → confirmed → processing/cooking → picked up/handover → out for delivery → delivered), **map with delivery-man live location + route** once assigned, ETA.
- **Chat / conversation**: in-app messaging (text + image) between customer and admin/restaurant and delivery man; **call** delivery man / restaurant via phone.
- **Order history** (running + past), **order details** with itemized receipt, **reorder** button, **track order**.
- **Cancel order** with reason (while cancellable), **refund request** flow (admin-mediated; refund to wallet or source).
- **Rate & review** after delivery: restaurant rating, **food/item rating**, and **delivery-man rating** (separate), plus written review; tip/review prompt post-delivery.
- Repeat/scheduled order management (view upcoming scheduled orders, cancel).

### Gaps
- StackFood in-app **edit order after placement** (add/remove items) is typically not supported for customers (cancel + reorder instead) — not confirmed this session.
- Just Eat / DoorDash / Uber Eats precise cancel-reason + refund self-service flows (2026) not captured from official help pages this session.

---

## Engagement (reviews/ratings, favourites, notifications, chat support, help center, dietary prefs)

### Takeaway
Reviews/ratings (restaurant + item), favourites/saved restaurants, multi-channel notifications, and in-app help/chat support are common. StackFood supports favorites, reviews, and push/SMS/email notifications.

### Cited Findings
- **Just Eat / Takeaway — leave ratings and reviews from account; re-order favourites.** — [Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md)
- **Deliveroo — in-app Help function to reach customer service and report issues; website contact form / email support; customers may be asked for feedback Deliveroo shares with other users (incl. on menu pages).** — [Deliveroo IE FAQ](https://deliveroo.ie/faq); [Deliveroo help](https://help.deliveroo.com/)
- **Just Eat — Stamp Card members receive branded marketing emails + push messages.** — [Just Eat Extra Helpings](https://extrahelpings.just-eat.ie/stampcards)
- **Uber Eats — in-dish allergy flagging + dietary section (dietary preference as engagement/profile).** — [Uber newsroom](https://www.uber.com/newsroom/making-food-delivery-more-accessible-sustainable)

### Inferences (StackFood — verify)
- **Favourites**: favorite restaurants list + favorite foods/items (heart toggle on cards and item pages).
- **Reviews & ratings**: submit star rating + text review for order/restaurant, item rating, delivery-man rating; view aggregate restaurant rating + reviews.
- **Notifications**: push notifications (Firebase), SMS (OTP + order updates via SMS gateways like Twilio/Nexmo/2Factor), email notifications; in-app notification center.
- **Help / support**: in-app conversation/chat with admin as support channel; FAQ/terms/privacy/about pages in-app; contact info.
- Dietary preference in StackFood limited to veg/non-veg filtering (no rich dietary-profile persistence).

### Gaps
- StackFood dedicated help-center / ticketing (vs chat-with-admin) unconfirmed.

---

## Verticals & Special Cases (group order, corporate/business, gift cards, alcohol/age verification, grocery)

### Takeaway
The big-4 extend into grocery/convenience, corporate accounts, gift cards, and age-verified alcohol; StackFood is restaurant-food-centric with limited grocery support and no native gift-card/corporate/age-verification modules.

### Cited Findings
- **Uber Eats — business/corporate meal group orders; Uber for Business group ordering solution for teams; participants need not belong to the org.** — [Uber Business group ordering](https://www.uber.com/business/solutions/eats/group-ordering/); [Uber blog: business meal group orders](https://www.uber.com/blog/business-meal-group-orders)
- **Deliveroo — alcohol/age-restricted flow**: checkout terms confirming 18+, two in-app reminders to have ID ready, rider ID scan (DOB + expiry check) + visual match at door, remove age-restricted items if underage/no ID but leave rest of order; Plus-for-companies business option. — [Deliveroo partner hub](https://help.deliveroo.com/en/articles/4775074-managing-age-restricted-items-in-partner-hub); [Deliveroo rider alcohol guidance](https://rider.deliveroo.co.uk/delivering-alcohol)
- **Takeaway.com — grocery vertical** (baby food, flowers, beer, wine, staples) selectable in app; **Deliveroo grocery partners** (Costa etc.) carry age-restricted items. — [Miracuves](https://miracuves.com/blog/key-features-of-justeat-food-delivery-app.md); [The Grocer: Deliveroo age checks](https://www.thegrocer.co.uk/online/new-age-check-policy-for-deliveroo-couriers-following-grocery-partnerships/605240.article)
- **Uber One — grocery delivery included in $0 delivery-fee benefit.** — [Uber blog 2025](https://www.uber.com/blog/new-benefits-for-uber-one-members-2025)

### Inferences (StackFood — verify)
- StackFood is primarily multi-restaurant food ordering; grocery/convenience is handled by 6amTech's separate products (e.g., 6amMart/6ammart multi-vendor grocery), not the StackFood user_app.
- No native **gift cards**, **corporate/business accounts**, or **alcohol age-verification** module in standard StackFood (confirm; these are big-4 differentiators to add to a backlog).
- **Group ordering** absent from StackFood (vs Uber Eats/DoorDash).

### Gaps
- DoorDash/Uber Eats gift-card and corporate (DoorDash for Business / Uber for Business) customer-side flows not captured in detail from official pages this session.
- Whether any StackFood v8 add-on introduces dine-in QR/table ordering at scale — unconfirmed.

---

## Cross-Platform Feature Matrix (quick reference — ✔ confirmed via source, ~ inferred/partial, ✘ absent, ? unknown)

| Feature | StackFood | DoorDash | Uber Eats | Deliveroo | Just Eat |
|---|---|---|---|---|---|
| Phone OTP login | ~ | ? | ? | ? | ~ |
| Social/Apple/Google login | ~ | ? | ✔(guest join) | ? | ~ |
| Guest checkout | ✔ | ? | ✔(group) | ? | ~ |
| Saved addresses (map pin) | ~ | ✔ | ✔ | ✔ | ✔ |
| Dark mode / multi-language | ~ | ? | ? | ? | ? |
| Dietary/allergy filters | ~(veg/non-veg) | ? | ✔ | ~ | ~ |
| Map view of restaurants | ~ | ? | ? | ? | ✔ |
| Delivery | ✔ | ✔ | ✔ | ✔ | ✔ |
| Pickup/Takeaway | ~ | ✔ | ✔ | ✔ | ✔ |
| Dine-in | ~ | ✘ | ✘ | ✘ | ✘ |
| Scheduled / pre-order | ✔ | ✔ | ✔ | ~ | ✔ |
| Group order + bill split | ✘ | ✔ | ✔ | ? | ? |
| COD / cash | ✔ | ✘(mostly) | ✘(mostly) | ✘(mostly) | ✔ |
| In-app wallet + partial pay | ✔ | ~(credits) | ~(credits) | ~(credit) | ? |
| Apple/Google Pay | ~ | ✔ | ✔ | ✔ | ✔ |
| PayPal | ~ | ? | ? | ? | ✔(Takeaway) |
| Coupons / promo codes | ~ | ✔ | ✔ | ✔ | ✔ |
| Loyalty / stamp cards | ~(points→wallet) | ? | ? | ? | ✔(Stamp Cards) |
| Referral program | ✔ | ? | ? | ? | ? |
| Subscription membership | ✘ | ✔ DashPass | ✔ Uber One | ✔ Plus/Plus Diamond | ~ |
| Live map tracking + ETA | ~ | ✔ | ✔ | ~ | ✔ |
| Chat with courier/restaurant | ~ | ✔ | ? | ? | ? |
| Reorder | ~ | ✔ | ~ | ? | ✔ |
| Cancel with reason | ~ | ? | ? | ✔ | ? |
| Tip (at + after delivery) | ~(at) | ✔(before/after) | ✔ | ? | ? |
| Rate/review (restaurant+item+courier) | ~ | ? | ? | ~ | ✔ |
| Favourites | ~ | ? | ~ | ? | ✔ |
| Grocery vertical | ✘(separate product) | ✔ | ✔ | ✔ | ✔(Takeaway) |
| Alcohol age verification | ✘ | ? | ? | ✔ | ? |
| Gift cards | ✘ | ✔ | ✔ | ? | ✔ |
| Corporate/business accounts | ✘ | ✔ | ✔ | ✔(Plus for companies) | ? |

*(Blank cells / "?" reflect features not confirmed from a source this session, not confirmed absence. "~" for StackFood marks strong product-knowledge inferences blocked from citation by the egress proxy.)*
