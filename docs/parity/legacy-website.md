# Legacy Tunakula website (tunakula.com, drc.tunakula.com) — migration notes

Source: page text supplied by the owner on 2026-10-04. Benchmark and migration input only (clean-room).

## Apps on Google Play (to redirect or update at migration, PRD §25)

| App | Package |
| --- | --- |
| Customer | com.tunakulacong.hadevelopers |
| Store (merchant) | com.tunakulacongostore.hadeveloper |
| Delivery (rider) | com.tunakulacddelivery.hadeveloper |

Domains in use: tunakula.com, drc.tunakula.com, cd.tunakula.com (admin and legal pages).

## Promises made to users (each needs an owner decision before migration)

| Legacy promise | New platform today | Decision needed |
| --- | --- | --- |
| Free delivery on orders above $200 | Not configured | Keep as a Country Profile threshold, or retire with notice |
| Loyalty points convertible to cash | Specified (loyalty liability account) | Earn and burn rates |
| $5 for each referral | Not specified | Keep, change or retire |
| Riders keep 70% of the delivery fee | Built (rider_share_bps 7000) | — |
| Riders keep 90% for 3 months after joining | Not configured | Keep as a time-boxed onboarding rate |
| 10% incentive for riders above a daily threshold | Built as rider_bonus_bps 1000 with zone budgets | Threshold per market |
| Tip before the order is placed | Built (tips in pricing) | — |
| Weekly automatic deposits | Payouts specified | Payout schedule per role |

## Content not carried over

- Headline counters ("2330+ reviews", "5000+ orders", "999+ users") — the legacy admin shows 109 orders; the
  new site publishes only figures backed by data.
- Testimonials — not verifiable and they describe "low commission"; the new platform charges 0%.

## Facts to confirm

- Legal entity: the legacy footer reads "Groupe JNN"; the new site and the PRD use "Groupe Nseya".
- Office address: C/S GPS Smart, Av. du Port N°17, immeuble SNCC, 1er niveau, Gombe, Kinshasa.
- Contact inbox: info@tunakula.com (the only inbox, per owner instruction).
