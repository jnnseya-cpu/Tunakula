# Rider / Courier / Delivery-Driver Feature Set — StackFood, DoorDash, Uber Eats, Deliveroo, Just Eat

Scope: the DRIVER-facing apps (StackFood "delivery man" app, DoorDash Dasher, Uber Driver/Uber Eats courier, Deliveroo Rider, Just Eat courier/Scoober). State as of 2026. StackFood is the benchmark codebase (Laravel admin + Flutter apps); its deliveryman app is Android-only Flutter and its feature set is deliberately called out per item.

Note on sourcing: Several primary driver-help domains (docs.6amtech.com, help.doordash.com, dasher.doordash.com, preview.6amtech.com) are blocked by the research egress proxy, so StackFood and some DoorDash internals are sourced from CodeCanyon/App Store listings, 6amTech blog snippets, and reputable third parties. Blocked-source items are flagged as inferences or gaps.

## Onboarding & account (signup, documents, vehicle, approval, profile, banking, training)

### Takeaway
DoorDash, Uber, Deliveroo and Just Eat all run self-service web/in-app signup with ID + vehicle + background checks and in-app payout setup; StackFood ships a far thinner deliveryman onboarding (admin-created or self-registered account, online/offline, "freelance" vs salaried distinction) with no built-in background-check or document-verification workflow visible in public docs.

### Cited Findings
- StackFood deliveryman app is a Flutter Android app ("Delivery Boy application developed for Android using Flutter"); vendor advises NOT shipping it on iOS because it fully depends on location — [6amTech / CodeCanyon via search summary](https://codecanyon.net/search/stackfood). StackFood ecosystem = 3 mobile apps + 2 web panels + website + landing + React web-app.
- StackFood distinguishes a **freelance delivery man** (sees an earning balance) from salaried/store delivery men (no earning balance shown) — [StackFood Delivery App Store listing](https://apps.apple.com/mx/app/stackfood-delivery/id6443522580).
- StackFood deliverymen can be **manually assigned by admin** or **self-select nearest orders**; admin sees available delivery boys with live location per zone — [6amTech docs via search](https://docs.6amtech.com/docs-stack-food/intro).
- DoorDash signup (official): age 18+ (19 in AL/NE, 21 in some areas), right to work in US/Canada, valid driver's licence, proof of auto insurance (if delivering by car), smartphone, SSN for background check; some markets require an on-demand video interview — [DoorDash Dasher signup help](https://help.doordash.com/en-us/dashers/article/dasher-signup-process) (via search summary).
- DoorDash background check = criminal history report + motor vehicle report (if driving); most within a day, some up to a week — [help.doordash.com signup](https://help.doordash.com/en-us/dashers/article/dasher-signup-process).
- DoorDash payout setup during signup: weekly direct deposit default, or "Choose Later" and use **DoorDash Crimson** / **Fast Pay**; activation kit (Red Card, food-warming bag, hand sanitizer, mask) is mailed after first dash — [DoorDash signup help](https://help.doordash.com/en-us/dashers/article/dasher-signup-process).
- Uber Eats courier: couriers register through the Uber platform; drivers eligible for **Uber Courier** (parcel/item delivery) receive an email + in-app invitation to opt in — [Uber Courier](https://www.uber.com/gt/en/deliver/item-delivery/).
- Uber Eats in-person ID verification (anti-fraud): launched Amsterdam 29 Apr 2024 — each delivery must be completed by the person registered on the account; a trained expert may approach couriers at the restaurant to verify — [Uber blog, Amsterdam ID checks](https://www.uber.com/en-NL/blog/amsterdam/uber-eats-in-person-id-checks).
- Just Eat UK courier signup: 18+, smartphone (iOS 15.5+ / Android), moped/bike/car with licence + correct insurance; everyone passes a criminal background + right-to-work check (~15 min); couriers submit weekly "run requests" and pick their own schedule — [Just Eat Couriers UK](https://couriers.just-eat.co.uk/).
- Just Eat Scoober app (UK employed model, being phased toward gig): courier logs in at shift start to receive first job; app shows current + upcoming jobs and navigation — [Scoober app, App Store listing summary](https://apps.apple.com/us/app/-/id964121026).
- Just Eat moving UK couriers entirely to self-employed gig model (ending employed Scoober contracts; ~1,700 jobs cut) — [Yahoo/Reuters](https://uk.news.yahoo.com/just-eat-takeaway-move-self-131140464.html); [ibtimes](https://www.ibtimes.co.uk/uk-food-delivery-app-axe-more-1700-jobs-1714416).

### Inferences
- Document upload (licence/insurance/vehicle reg/selfie) and background checks are native to DoorDash/Uber/Deliveroo/Just Eat but appear to be OUT of scope for stock StackFood — StackFood onboarding is operator-configured in the admin panel, not a consumer-grade document pipeline.
- Vehicle-type selection exists on all four commercial platforms (bike/moped/scooter/car); StackFood vehicle handling is admin-side configuration, not clearly a driver-app self-service feature.

### Gaps
- No public confirmation of StackFood deliveryman **self-registration/signup flow in the app**, document upload, selfie/background check, banking/payout setup screen, or training/quizzes. Likely admin-created accounts; confirm in docs.6amtech.com (blocked) or admin panel.
- Deliveroo rider onboarding specifics (right-to-work, substitute policy, equipment kit) not retrieved in detail.

## Availability & shifts (online/offline, GPS, scheduling, zones, hotspots, assignment)

### Takeaway
Deliveroo is the scheduling-heavy outlier (Free Login zones vs booked sessions via the Planner, zone-locked), DoorDash blends Dash Now + scheduled slots, Uber is free online-anytime with heatmaps/Destination Mode, Just Eat uses weekly run requests + shift add; StackFood offers a simple online/offline toggle with zone-based nearest-order selection.

### Cited Findings
- **StackFood**: deliveryman app has online/offline status change; driver sees nearest orders and accepts; whole system is zone-based ("fully depends on operation zone"); admin draws coverage area on map and views live delivery-boy locations per zone — [StackFood App Store](https://apps.apple.com/mx/app/stackfood-delivery/id6443522580); [6amTech docs via search](https://docs.6amtech.com/docs-stack-food/intro).
- **Deliveroo Free Login zones**: go online anytime within the zone's opening hours, no advance booking — [Deliveroo IT riders, Free Login](https://riders.deliveroo.it/en/first-order).
- **Deliveroo booked/Calendar zones**: reserve sessions via the **Planner** in the Rider app; bookings open each Monday 3pm for the following week (and remaining days after) — [Deliveroo IT applicants](https://riders.deliveroo.it/en/applicants).
- **Deliveroo zones**: each zone is a small map area; UK app has a **"Change area"** button under "Ready to ride?"; must be physically close to the zone to go online; leaving your zone can get you "called back" with your next order unless you manually switch — [Deliveroo UK FAQ, change area](https://rider.deliveroo.co.uk/support/faq-rider-app/how-can-i-change-the-area-i-work-with-deliveroo-in); [Singapore rider account](https://clara.beehiiv.com/p/being-a-deliveroo-rider-in-singapore).
- **Deliveroo**: app shows busy zones on a map to help riders earn more; Go online = "Ready to ride?" → go online — [Deliveroo FR apply](https://riders.deliveroo.fr/en/apply).
- **DoorDash**: Dash Now (start immediately where available) vs schedule time slots in advance → push notifications for nearby orders during chosen slots — [Dasher app guide via search](https://dasher.doordash.com/en-us/blog/how-to-use-dasher-app).
- **Uber Driver** Home screen: go online, view busy areas + hourly trends, Safety Toolkit; tap map to see busy areas and report road hazards; **Discover** tab for promotions/reservations/local events; courier **delivery heatmap** (red=busiest, orange=medium, yellow=least) — [Uber driver app](https://www.uber.com/us/en/deliver/driver-app/); [Uber Only-on-Uber fall 25](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25).
- **Uber Destination Mode** (2025 redesign): only receive trip requests moving you toward your set destination, filtered by direction/distance/time — [Uber fall 2025 release](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25).
- **Just Eat**: couriers add shifts in the app each week, can pick up open shifts for more money; submit weekly run requests — [JustEat Swiss courier ads](https://jobup.ch/en/jobs/detail/780edf99-f599-4005-9421-6b6526903d0a); [Just Eat Couriers UK](https://couriers.just-eat.co.uk/).

### Inferences
- Auto-assign-nearest is the StackFood default dispatch (plus manual admin assignment); DoorDash/Uber/Deliveroo push offers to nearby online drivers (free-for-all accept/reject); Just Eat pushes offers to on-shift couriers.
- GPS location sharing is mandatory and continuous on all five (StackFood explicitly "fully depends on location").

### Gaps
- Deliveroo "priority/statistics" scheduling tiers (which riders get first pick of sessions) not retrieved with an official source this pass.

## Job/order flow (offers, navigation, pickup, delivery proof, contact, failed delivery)

### Takeaway
All platforms share the accept/reject-offer → navigate → confirm pickup → confirm delivery loop; divergence is in proof-of-delivery (Uber PIN + photo for Leave-at-Door; StackFood admin-toggled delivery photo), batching (DoorDash batched/stacked; Uber extra-stops), and merchant-paid pickups (DoorDash Red Card).

### Cited Findings
- **StackFood**: driver sees nearest orders and accepts for delivery; v7.2 adds **"Pickup & Delivery Location"** view in the deliveryman app; **Delivery Verification** (admin toggle in Business Settings, v7.1) requires deliveryman to submit a **photo after delivery**, visible to admin/restaurant/deliveryman/customer — [6amTech v7.2](https://6amtech.com/?p=25418); [6amTech v7.1](https://6amtech.com/blog/stackfood-v7-1/).
- **StackFood** order-confirmation models: "deliveryman-first" model lets a driver accept the order BEFORE the restaurant starts prep (vendor claims this removes cancellations from no-driver) — [6amTech, order confirmation models](https://6amtech.com/blog/stackfoods-order-confirmation-models/).
- **StackFood** admin **Order Re-assign** (v7.2) swaps the deliveryman on an ongoing order (handles can't-complete cases) — [6amTech v7.2](https://6amtech.com/?p=25418).
- **DoorDash**: tap **Accept** to claim; decline allowed (consequence depends on earning mode); **batched orders** = two pickups from one location + two separate drop-offs, app suggests sequence but Dasher can choose order — [Dasher app guide](https://dasher.doordash.com/en-us/blog/how-to-use-dasher-app).
- **DoorDash Red Card**: prepaid card for pay-at-counter orders; app flags when an order needs it with instructions; PIN prompt = 0000; verify items/quantity/weight/approved substitutions before paying — [DoorDash earning/safety pages via search](https://about.doordash.com/en-us/news/dasher-earning-product-announcement).
- **Uber redesigned offer card** (2025): longer request window + more info including extra stops — [Uber fall 2025](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25).
- **Uber Eats proof of delivery**: Leave-at-Door → courier takes a **photo** at the door as confirmation (not accessible to courier after, deleted when app closed) — [TechCrunch, Uber Eats info sharing](https://techcrunch.com/2023/01/27/uber-eats-now-shows-how-much-information-shared-delivery-people/); [Uber contact-free deliveries](https://www.uber.com/en-GB/blog/contact-free-deliveries/).
- **Uber Eats PIN**: 4-digit code required for hand-to-customer orders (not Leave-at-Door); often last 4 digits of customer phone; courier enters before handing over — [Financial Panther, Uber Eats PIN](https://financialpanther.com/uber-eats-pin/).
- **Uber "View as Delivery Person"** (Jan 2023, US/CA): shows customer what courier can see; after delivery courier sees location but not house/unit number — [TechCrunch](https://techcrunch.com/2023/01/27/uber-eats-now-shows-how-much-information-shared-delivery-people/).
- **Deliveroo** order flow: while online, offers show fee + restaurant + customer locations; **"Accept and go"** to accept or reject; app provides a route to the customer after accept — [Deliveroo IT first order](https://riders.deliveroo.it/en/first-order1); [Lexham blog](https://www.lexhaminsurance.co.uk/blog/how-much-do-deliveroo-riders-make/).
- **Just Eat**: app sends delivery **"offers"**; courier reviews each and decides whether to take it — [Just Eat Couriers UK](https://couriers.just-eat.co.uk/).

### Inferences
- In-app navigation + external map handoff (Google Maps/Waze) is standard on DoorDash/Uber/Deliveroo/Just Eat; StackFood shows pickup/delivery locations on map but deep-link navigation richness is unconfirmed.
- Customer/restaurant contact via masked call/chat exists on all four commercial apps; StackFood has real-time notifications but masked-number/in-app-chat for drivers is unconfirmed.
- Wait-time compensation and failed-delivery/"can't find customer" flows are native to DoorDash/Uber/Deliveroo/Just Eat; StackFood handles can't-complete via admin Order Re-assign rather than a driver-side failed-delivery flow.

### Gaps
- No StackFood evidence of PIN/OTP at delivery for the DRIVER (OTP in stock script is customer-login only per a CodeCanyon comment), signature capture, contactless toggle, or in-app masked calling for drivers.
- Deliveroo PIN/photo proof-of-delivery, multi-pickup/stacked orders, and wait-time pay not confirmed with official sources this pass.

## Earnings & payments (breakdown, cashout, cash-on-delivery, wallet, incentives, referrals)

### Takeaway
Uber and DoorDash expose rich per-offer earnings breakdowns + instant cashout + quests/boosts; Deliveroo shows per-order fee + tips with daily cash-out; StackFood's money model centers on cash-collection remittance ("Cash in Hand"/pay dues digitally) and a freelance earning balance rather than consumer-grade instant payout.

### Cited Findings
- **StackFood**: freelance deliveryman sees an **earning balance**; deliverymen can **Pay Dues Digitally** (wallet + third-party payment options) to the admin; v7.2 adds **"Cash in Hand Overflow"** (cap/limit on collected cash before remittance) — [StackFood App Store](https://apps.apple.com/mx/app/stackfood-delivery/id6443522580); [6amTech v7.2](https://6amtech.com/?p=25418); [CodeCanyon comments](https://codecanyon.net/comments/31708940).
- **StackFood**: admin can configure a **commission for the administrator of delivery man** (commission handling configurable) — [CodeCanyon comments](https://codecanyon.net/comments/31708940).
- **DoorDash Earn by Time** (June 2023): guaranteed hourly minimum for active delivery time (accept → drop-off) + 100% of tips; hourly rate shown at dash start; alternative to **Earn per Offer** — [DoorDash earning announcement](https://about.doordash.com/en-us/news/dasher-earning-product-announcement).
- **DoorDash Fast Pay**: cash out daily for a small fee (reported ~$1.99/transfer, unconfirmed officially); **DasherDirect/Crimson** prepaid card gives instant access after each delivery; default weekly direct deposit — [DoorDash signup help](https://help.doordash.com/en-us/dashers/article/dasher-signup-process).
- **DoorDash promotions**: guaranteed-earnings incentives (top-up to a set amount for N deliveries in a set period); Peak Pay surge referenced by driver guides — [DoorDash earning announcement](https://about.doordash.com/en-us/news/dasher-earning-product-announcement).
- **Uber Driver earnings**: Earnings section summarizes recent weekly earnings + **cash-out options** (Instant Pay); couriers paid per completed trip (not hourly/weekly) — [Uber driver app](https://www.uber.com/us/en/deliver/driver-app/); [Uber deliver earnings](https://www.uber.com/us/en/deliver/earnings/).
- **Uber incentives**: **Quest** (earn more for N trips meeting criteria, opt in via Discover); **Boost+** (extra on every trip started+completed in an area) — [Uber fall 2025 release](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25).
- **Uber digital-tasks pilot** (2025): quick in-app digital tasks during downtime (e.g., uploading photos to train AI) for extra pay; tested in India, launching US — [Uber fall 2025](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25).
- **Deliveroo**: per-order fee + customer tips; earnings transferred every two weeks but riders can **cash out daily** in-app; monitor daily/weekly income in real time; bonus/extra payments shown in the **Planner** or by email — [Lexham Deliveroo pay](https://www.lexhaminsurance.co.uk/blog/how-much-do-deliveroo-riders-make/); [Deliveroo IT applicants](https://riders.deliveroo.it/en/applicants); [mwm.ai listing](https://mwm.ai/apps/id/1438758758).
- **Just Eat**: paid per delivery; **weekly direct bank deposits**; tips passed to courier (employed Swiss model adds hourly pay, phone allowance 0.12 CHF/hr, vehicle allowance) — [Just Eat Couriers UK](https://couriers.just-eat.co.uk/); [JustEat Swiss ads](https://jobup.ch/en/jobs/detail/780edf99-f599-4005-9421-6b6526903d0a).

### Inferences
- Per-order earnings breakdown (base + tip + promo + distance/peak) is explicit on DoorDash/Uber and partial on Deliveroo; StackFood shows an aggregate earning balance, not a line-item breakdown, in stock form.
- Cash-on-delivery collection + remittance is a first-class StackFood feature ("Cash in Hand Overflow", pay dues digitally) because StackFood targets COD-heavy markets — a notable differentiator vs the Western platforms where COD is rare.

### Gaps
- StackFood: no confirmed driver-side **withdrawal request** flow to a bank (the digital payment is drivers paying dues TO admin, not withdrawing earnings); referral bonuses for drivers unconfirmed.
- Referral bonuses, exact surge/peak-pay mechanics, and challenge/quest UIs for Deliveroo and Just Eat not retrieved.

## Performance & status (acceptance/completion rate, ratings, tiers, deactivation)

### Takeaway
DoorDash (Top Dasher, acceptance/completion rates) and Uber (Uber Pro / Uber Eats Pro tiers) expose formal performance metrics and reward tiers; Deliveroo has priority/statistics-based session access; StackFood exposes no visible performance-tier system in public materials.

### Cited Findings
- **DoorDash**: app ranks Dashers by **acceptance rate** (share of offered orders accepted); very low acceptance can risk standing (per driver guides, not confirmed policy) — [Dasher app guide](https://dasher.doordash.com/en-us/blog/how-to-use-dasher-app).
- **Uber Eats Pro** (courier rewards): tiers **Green, Gold, Platinum, Diamond**; Gold+ unlock higher earnings than Green; limited to select cities; Uber may change/terminate — [Uber Pro](https://www.uber.com/us/en/deliver/uber-pro/).
- **Uber Pro** (drivers, 2025 relaunch unifying Pro + Advantage Mode): four tiers **Blue, Gold, Platinum, Diamond**; Gold+ see higher earnings on most trips — [Uber fall 2025 release](https://www.uber.com/us/en/u/only-on-uber/releases/fall-25).
- **Just Eat** uses algorithmic performance/deactivation: couriers reportedly deactivated by AI for alleged overpayments as small as £1.35 — [BHRRC / Guardian](https://www.bhrrc.org/en/latest-news/fired-by-ai-just-eat-uk-couriers-deactivated-for-minor-overpayments/).

### Inferences
- Completion rate, on-time metrics and ratings surfaced to drivers on DoorDash/Uber/Deliveroo; Deliveroo's "Calendar with statistics" zones gate better session access on performance stats (implied by the Free Login vs statistics-zone distinction).
- StackFood has no public tier/standing/ratings-for-drivers system; driver reliability is managed admin-side.

### Gaps
- DoorDash Top Dasher exact criteria (acceptance ≥70%, completion ≥95%, ratings ≥4.7, deliveries/month) not retrieved from an official source this pass.
- Deliveroo rider rating and priority-access thresholds; Uber ratings/cancellation thresholds for deactivation — not retrieved with official sources.

## Support & safety (in-app support, safety toolkit, SOS, incident/insurance, appeals)

### Takeaway
DoorDash (SafeDash/ADT) and Uber (Safety Toolkit) ship dedicated in-app safety suites with emergency/reassurance features and accident insurance; Just Eat/Scoober offer in-app chat support; StackFood relies on real-time notifications + admin contact with no evident safety toolkit.

### Cited Findings
- **DoorDash SafeDash** (Nov 2021, with ADT): in-app **Safety Reassurance Call** to an ADT agent; if Dasher becomes unresponsive, ADT contacts 911 with last known GPS; current safety page lists SafeDash + occupational accident policy + more in the Dasher app — [TechCrunch SafeDash](https://techcrunch.com/2021/11/03/doordash-rolls-out-safedash-an-in-app-security-toolkit-for-delivery-people-on-the-platform/amp/); [DoorDash Safety](https://about.doordash.com/en-us/safety).
- **Uber Driver Safety Toolkit**: reachable from Home screen; tap map to report road hazards — [Uber driver app](https://www.uber.com/us/en/deliver/driver-app/).
- **Just Eat / Scoober**: in-app **chat** to get help during a shift — [Scoober App Store listing summary](https://apps.apple.com/us/app/-/id964121026).
- **Just Eat** couriers have appeals context via group legal claims over deactivation/status (Leigh Day) — [Leigh Day Just Eat claim](https://leighday.co.uk/our-services/group-claims/just-eat-couriers-claim).

### Inferences
- Uber Safety Toolkit standard components (share trip/location, emergency 911 button, RideCheck/anomaly detection, audio recording in some markets) apply to the courier app; Deliveroo Rider app includes in-app support + reporting; StackFood has no comparable safety module in stock.
- Incident/accident reporting + occupational accident insurance are platform-provided on DoorDash/Uber; Deliveroo provides free insurance to riders (common knowledge, not sourced this pass).

### Gaps
- Deliveroo SOS/incident-reporting specifics and Uber Eats trip-sharing exact UI not retrieved.
- StackFood: no evidence of any SOS, incident reporting, or appeals feature in the deliveryman app.

## Other (history, scheduled, pickup-only, parcel/grocery, notifications, settings, language, dark mode, vehicle switching)

### Cited Findings
- **StackFood**: **Order history** view; **real-time notifications**; multilingual platform; online/offline toggle — [StackFood App Store](https://apps.apple.com/mx/app/stackfood-delivery/id6443522580). (Known bug: background/foreground notification sound issues reported — [CodeCanyon comments](https://codecanyon.net/comments/31708940).)
- **Uber Courier**: parcel/item delivery added to a driver's offerings via opt-in — [Uber Courier](https://www.uber.com/gt/en/deliver/item-delivery/).
- **Uber Discover tab**: upcoming reservations, promotions, local events — [Uber driver app](https://www.uber.com/us/en/deliver/driver-app/).
- **Just Eat / Scoober**: app shows current + upcoming jobs and city navigation; navigation is battery-heavy (~2 GB data/month) — [Scoober App Store listing summary](https://apps.apple.com/us/app/-/id964121026).
- **Deliveroo Rider** app on App Store + Google Play; shows zone map + go online — [Deliveroo Rider iOS](https://apps.apple.com/app/id1438758758).

### Inferences
- Grocery/retail/convenience deliveries flow through the same driver apps on DoorDash (DashMart/retail), Uber (grocery), Deliveroo (Hop/grocery); StackFood is a restaurant-centric codebase (multi-restaurant), so parcel/grocery is not a native driver-app mode.
- Dark mode, language selection, vehicle switching, and notification settings are standard settings-screen items on the commercial apps; StackFood is multilingual but dark-mode/vehicle-switching in the driver app is unconfirmed.

### Gaps
- Dark mode, language picker, vehicle switching presence in each specific driver app (incl. StackFood) not individually confirmed.
- Scheduled/pre-order delivery handling for the driver, and pickup-only modes, not confirmed per platform.

---
## Cross-platform quick matrix (feature → platforms; ✓ confirmed, ~ inferred, ✗ absent/unconfirmed)
- Self-service in-app signup + document/background check: DoorDash ✓, Uber ✓, Deliveroo ~, Just Eat ✓; StackFood ✗ (admin-managed).
- Online/offline toggle: all ✓ (StackFood ✓).
- Scheduled shifts/sessions: Deliveroo ✓ (Planner/Free Login), DoorDash ✓ (slots), Just Eat ✓ (weekly run requests/shifts), Uber ~ (reservations), StackFood ✗.
- Busy-area heatmap/hotspots: Uber ✓, Deliveroo ✓, DoorDash ~ (hotspots), Just Eat ✗, StackFood ✗.
- Accept/reject offer with info: all ✓ (StackFood ✓ nearest-order accept).
- Batched/stacked orders: DoorDash ✓, Uber ✓ (extra stops), others ~.
- Offer timer/earnings-shown-on-offer: DoorDash ✓, Uber ✓, Deliveroo ✓ (fee shown); StackFood ✗.
- In-app navigation: DoorDash ✓, Uber ✓, Deliveroo ✓, Just Eat ✓, StackFood ~ (location view).
- Photo proof of delivery: Uber ✓ (Leave-at-Door), StackFood ✓ (admin-toggled Delivery Verification); DoorDash ✓; others ~.
- PIN/code delivery confirmation: Uber ✓ (hand-to-customer); DoorDash ~ (some orders); StackFood ✗ (OTP is customer-login only).
- Merchant pay-at-counter card: DoorDash ✓ (Red Card); others ✗.
- Instant/fast cashout: DoorDash ✓ (Fast Pay/Crimson), Uber ✓ (Instant Pay), Deliveroo ✓ (daily cash-out); Just Eat ✗ (weekly); StackFood ✗.
- Cash-on-delivery collection + remittance: StackFood ✓ ("Cash in Hand Overflow", pay dues digitally) — standout feature; commercial platforms largely ✗.
- Per-order earnings breakdown: DoorDash ✓, Uber ✓, Deliveroo ~; StackFood ✗ (aggregate balance).
- Incentives/quests/bonuses: Uber ✓ (Quest/Boost+), DoorDash ✓ (guaranteed earnings/Peak Pay), Deliveroo ✓ (zone bonuses); Just Eat ~; StackFood ✗.
- Performance tiers: Uber ✓ (Uber (Eats) Pro: Blue/Green→Diamond), DoorDash ✓ (Top Dasher + acceptance/completion), Deliveroo ✓ (statistics zones); Just Eat ~ (algorithmic); StackFood ✗.
- Safety toolkit/SOS: DoorDash ✓ (SafeDash/ADT), Uber ✓ (Safety Toolkit); Deliveroo ~, Just Eat ✗ (chat only), StackFood ✗.
- Order history: all ✓ (StackFood ✓).
- Parcel/grocery/retail delivery mode: Uber ✓ (Courier), DoorDash ✓, Deliveroo ✓; Just Eat ~; StackFood ✗ (restaurant-only).
