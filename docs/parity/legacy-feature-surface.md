# Legacy StackFood Platform — Feature Surface Inventory

**Target:** `cd.tunakula.com` (API + Laravel admin/landing) & `drc.tunakula.com` (customer Flutter web app)
**Platform identified:** StackFood multi-restaurant / multi-vendor food delivery, **v8.0.0** (6amTech).
Branding: "Tunakula RDC" / "Tunakula-Congo" (DR Congo), currency CD ($ symbol), default language French (`fr`).
Firebase project `stackfood-bd3ee`, GTM `GTM-W4MNM39Z`, Google Maps key present.

**Method:** Evidence is (a) API path string literals grepped from the customer Flutter bundle
`https://drc.tunakula.com/main.dart.js` (5.8 MB, dart2js), (b) HTML/links from `cd.tunakula.com/` and
`cd.tunakula.com/login/admin`, and (c) live unauthenticated GET probes against `https://cd.tunakula.com/api/v1/...`
with headers `X-localization: fr`, `zoneId: [1]`, `moduleId: 1`.
**Probe status legend:** `200`=open/returns data · `401/403 keys:errors`=exists, needs auth/zone/params ·
`405`=exists, POST-only route (GET rejected) · `302`=exists, redirects to login (web-guard) · `404`=route absent.
No logins, POSTs, form/captcha submissions, or mutations were performed — GET probes only.

---

## CUSTOMER

### Authentication & account
- Login (phone/email + password) — `POST api/v1/auth/login` — **405** (exists)
- Sign-up / registration — `POST api/v1/auth/sign-up` — **405** (exists) *(no `auth/registration`, 404)*
- OTP phone verification — `POST api/v1/auth/verify-phone` — **405**
- Token verification — `POST api/v1/auth/verify-token` — **405**
- Forgot password — `POST api/v1/auth/forgot-password` — **405**
- Reset password — `POST api/v1/auth/reset-password` — **405**
- Firebase OTP reset / verify-token — `auth/firebase-reset-password`, `auth/firebase-verify-token` (bundle)
- Guest checkout request — `POST api/v1/auth/guest/request` — **405** (config `guest_checkout_status=0`, disabled)
- Update account info (post-social) — `POST api/v1/auth/update-info` — **405**
- Customer profile info — `api/v1/customer/info` — **302** (auth-guarded)
- Update profile — `api/v1/customer/update-profile` (bundle)
- Update dietary interest — `api/v1/customer/update-interest` (bundle)
- Update active zone — `api/v1/customer/update-zone` (bundle)
- Register FCM push token — `api/v1/customer/cm-firebase-token` (bundle)
- Delete / remove account — `api/v1/customer/remove-account` (bundle)
- Google sign-in (client_id in page; `auth/social-login` route = 404, likely handled via firebase-verify-token)

### Address book
- List addresses — `api/v1/customer/address/list` — **302** (auth)
- Add address — `POST api/v1/customer/address/add`
- Update address — `POST api/v1/customer/address/update/{id}`
- Delete address — `api/v1/customer/address/delete`
- Resolve zone for coordinates — `api/v1/config/get-zone-id` (**403**), `api/v1/zone/check` (**403**), `api/v1/zone/list` (**200**, 5 zones)

### Discovery / catalogue / search
- App config (feature flags, branding, payment, policies) — `api/v1/config` — **200** (117 keys)
- Categories tree — `api/v1/categories` (**200**, 17) · child categories `categories/childes/{id}` · category products `categories/products/{id}` · category restaurants `categories/restaurants/{id}`
- Cuisines — `api/v1/cuisine` (**200**) · restaurants by cuisine `cuisine/get_restaurants`
- Banners & promo campaigns — `api/v1/banners` (**200**, keys campaigns,banners)
- Restaurants: all/filter `restaurants/get-restaurants/all` (**200**), `latest`, `popular`, `dine-in`, details `restaurants/details/{id}`, `recently-viewed-restaurants`, reviews `restaurants/reviews`
- Products: `products/latest`(**403**), `products/popular`(**200**), `products/recommended`(**403**), `products/most-reviewed`(**200**), `products/recommended/most-reviewed`, details `products/details/{id}`, `products/search`(**200**), combined `products/food-or-restaurant-search`
- Food list (by filters) — `api/v1/customer/food-list`
- Suggested foods — `api/v1/customer/suggested-foods` — **302**
- "Most tips" restaurants — `api/v1/most-tips` — **200**
- Advertisements — `api/v1/advertisement/list` — **200** (empty)
- Campaigns: basic details `campaigns/basic-campaign-details`, item campaigns `campaigns/item` (**200**)

### Cart
- List / add / add-multiple / update / remove / remove-item — `api/v1/customer/cart/*` (`cart/list` **401**)

### Ordering & checkout
- Place order — `POST api/v1/customer/order/place`
- Order list / running / details / track — `customer/order/list` (**401**), `order/running-orders` (**401**), `order/details`, `order/track`
- Re-order — `api/v1/customer/order-again` — **401**
- Payment methods — `api/v1/customer/order/payment-method` — **405**
- Offline payment + update — `customer/order/offline-payment`, `offline-payment-update`; methods list `offline_payment_method_list` (**200**, 2)
- Cancel order + reasons — `order/cancel`, `order/cancellation-reasons` (**403**)
- Refund request + reasons — `order/refund-request`, `order/refund-reasons` (**401**) (config `refund_active_status=true`)
- Order subscription (recurring orders) — `order/order-subscription-list`, `customer/subscription/{...}` (config `order_subscription=1`)
- Notify restaurant — `order/send-notification/{id}`
- Scheduled orders (config `schedule_order=true`), instant order (`instant_order=true`), take-away & home delivery (`take_away`/`home_delivery=true`)

### Wallet, loyalty, coupons, cashback, referrals
- Wallet: transactions `customer/wallet/transactions` (**302**), add-fund `wallet/add-fund`, bonuses `wallet/bonuses` (config `customer_wallet_status=1`, `add_fund_status=1`)
- Loyalty points: transactions `loyalty-point/transactions` (**302**), convert/transfer to wallet `loyalty-point/point-transfer` (config `loyalty_point_status=1`)
- Referral earnings — config `ref_earning_status=1`
- Coupons: list `api/v1/coupon/list` (**302**), apply `coupon/apply`, restaurant-wise `coupon/restaurant-wise-coupon`
- Cashback: `cashback/list` (**302**), `cashback/getCashback`

### Reviews, wishlist, chat, notifications
- Submit product review — `POST api/v1/products/reviews/submit`
- Submit delivery-man review — `POST api/v1/delivery-man/reviews/submit` — **302** (exists)
- Wishlist: list `customer/wish-list` (**302**), add, remove
- Conversations/chat with restaurant & admin — `customer/message/list` (**302**), `message/details`, `message/search-list`, `message/send`
- Notifications — `api/v1/customer/notifications` — **302**
- Newsletter subscribe — `POST api/v1/newsletter/subscribe` — **405**

---

## BUSINESS / VENDOR (Restaurant panel & app)
*The restaurant app is a separate build; namespace confirmed live against the same API.*
- Vendor login — `POST api/v1/auth/vendor/login` — **405** (exists)
- Vendor profile — `api/v1/vendor/profile` — **401** (exists)
- Update profile — `api/v1/vendor/update-profile` — **405**
- Current orders — `api/v1/vendor/current-orders` — **401**
- All orders — `api/v1/vendor/all-orders` — **401**
- Update order status — `POST api/v1/vendor/update-order-status` — **405**
- Notifications — `api/v1/vendor/notifications` — **401**
- Withdraw methods — `api/v1/vendor/withdraw-method/list` — **401**
- Withdraw request list — `api/v1/vendor/get-withdraw-list` — **401**
- Wallet / earnings payment list — `api/v1/vendor/wallet-payment-list` — **401**
- Expenses — `api/v1/vendor/get-expense` — **401**
- Self-registration (become a restaurant) — `POST api/v1/auth/vendor/register` — **405**; subscription packages `api/v1/vendor/package-view` (**200**, keys packages); business plan `vendor/business_plan` (**405**). Config `toggle_restaurant_registration=false` (currently off), `commission_business_model=1`, `subscription_business_model=0`.
- *(StackFood vendor also provides: food/menu CRUD, campaigns join, coupons, reviews, bank-info, employee roles, reports, POS — these live behind auth and/or in the admin panel; see "Could NOT verify".)*

---

## RIDER / DELIVERY-MAN (Delivery app)
*Separate build; namespace confirmed live.*
- Delivery-man login — `POST api/v1/auth/delivery-man/login` — **405** (exists)
- Self-registration — `POST api/v1/auth/delivery-man/store` — **405**; web apply form `/deliveryman/apply` (landing link); config `toggle_dm_registration=true`
- Profile — `api/v1/delivery-man/profile` — **401**
- Current orders — `api/v1/delivery-man/current-orders` — **401**
- All orders — `api/v1/delivery-man/all-orders` — **401**
- Update order status — `POST api/v1/delivery-man/update-order-status` — **405**
- Record GPS location — `POST api/v1/delivery-man/record-location-data` — **405**
- Toggle active/online status — `POST api/v1/delivery-man/update-active-status` — **405**
- Notifications — `api/v1/delivery-man/notifications` — **401**
- Withdraw methods — `api/v1/delivery-man/withdraw-method/list` — **401**
- Receive customer reviews — `delivery-man/reviews/submit` (**302**)
- Available vehicle types — `api/v1/get-vehicles` (**200**, 2) · extra charge by vehicle `api/v1/vehicle/extra_charge`
- Config: picture-upload required (`dm_picture_upload_status=1`), tips to rider currently off (`dm_tips_status=0`)
- *(StackFood rider also provides: order-delivered, cash collection/payment, earnings/withdraw history — behind auth; see "Could NOT verify".)*

---

## ADMIN (Laravel web panel — `cd.tunakula.com`)
Not enumerable at API granularity (server-rendered, auth + behind the described captcha). Confirmed surface:
- Admin / vendor unified login — form `POST /login_submit`; password reset `POST /vendor-reset-password`; page title "se connecter | Tunakula RDC" ("Signine à votre panneau")
- Landing/marketing site routes: `/about-us`, `/contact-us`, `/privacy-policy`, `/terms-and-conditions`, `/deliveryman/apply`, language switch `/lang/en`, `/lang/fr`
- Admin asset bundle present (`public/assets/admin/...`: select2, toastr, intlTelInput, theme.min.js) — standard StackFood admin dashboard.
- By platform convention the admin panel manages: zones, modules, restaurants/vendors, delivery-men, customers, categories/cuisines, foods/add-ons, orders, campaigns, coupons, banners, advertisements, loyalty/wallet, withdrawals, subscriptions, reports/analytics, employees & roles, business/payment/policy settings, push notifications. **These are inferred, not probed** (see below).

---

## PLATFORM / CONFIG (shared)
- Global config `api/v1/config` (**200**) + geocoding helpers: `config/distance-api`, `config/geocode-api`, `config/place-api-autocomplete`, `config/place-api-details`, `config/get-zone-id`
- Zones: `zone/list` (**200**, 5 zones), `zone/check`
- Multi-module (food module id=1) via `moduleId` header
- Payment: active gateway **stripe** (`active_payment_method_list`); plus COD (`cash_on_delivery=true`), offline payment (`offline_payment_status=1`). Partial payment off.
- Policies toggles: cancellation/refund/shipping/privacy policy statuses; additional charge on; veg/non-veg toggle on; country picker on.
- Payment redirect `https://cd.tunakula.com/payment-mobile`; notification media under `/storage/app/public/notification/`.

---

## French UI labels harvested (landing page)
- "Pourquoi rester affamé !" (Why stay hungry!)
- "Trouvez le meilleur service de livraison près de chez vous." (Find the best delivery service near you.)
- "Se joindre à nous" (Join us)
- "Télécharger" (Download)
- "politique de confidentialité" (privacy policy)
- "à propos de nous" (about us)
- Admin login: "se connecter", "Signine à votre panneau"
*(The Flutter customer app loads its localized strings from the API/asset JSON at runtime, so French labels are not hard-coded in `main.dart.js`; the UI language is driven by `X-localization: fr`.)*

---

## Could NOT verify / gaps & what's needed
1. **Admin panel screens** — behind login + the described captcha; not probed. *Needed:* screenshots or a read-only admin session, or admin-side route list from the Laravel `routes/` files.
2. **Authenticated vendor/rider detail endpoints** (menu CRUD, bank-info, earnings/withdraw history, order-delivered, cash collection, campaigns join, employee roles, POS). Confirmed the namespaces exist (401) but exact paths/response shapes need a **non-captcha vendor and rider API token** to probe with Authorization.
3. **Authenticated customer response shapes** (order list, wallet, chat) — routes confirmed via 401/302 but bodies need a customer bearer token.
4. **Exact path list for the vendor & rider Flutter apps** — only the customer bundle (`drc`) was fetched. *Needed:* the vendor/rider web build URLs (their own `main.dart.js`) to grep their full API path set.
5. Several paths returned **500** (`restaurants/latest|popular|dine-in`) — route exists but errored on the unauth probe (likely needs valid lat/long or auth), so shapes unconfirmed.
