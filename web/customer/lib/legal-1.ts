import type { Policy } from "./legal-types";

const ENTITY =
  "Tunakula is operated by Groupe Nseya. The company that provides the service in your country, its registration number and registered address are listed in the Legal notice [to be completed for each market before launch].";

export const CUSTOMER_POLICIES: Policy[] = [
  {
    slug: "terms",
    title: "Terms of Use",
    audience: "Customers",
    summary: "The agreement between you and Tunakula when you order, pay, send a meal home or leave a review.",
    sections: [
      { h: "Who we are", p: [ENTITY, "Tunakula is a marketplace. The restaurant, shop or other merchant you order from prepares and sells the goods; Tunakula provides the app, the website, ordering, payment orchestration, delivery and support."] },
      { h: "Your account", p: [
        "You sign in with your mobile number and a one-time code sent by SMS or WhatsApp. One account works in every country where Tunakula operates.",
        "Keep your details accurate, use the account yourself and keep your codes private. You are responsible for orders placed from your account unless you tell us it was misused.",
        "You may guest-order: an account is created when the order completes so you can track it, rate it and get help.",
      ] },
      { h: "Prices and what you pay", p: [
        "Food prices are set by the merchant and should be the same as at their counter. Before you pay, you see every line: the goods, the 10% service charge, the delivery fee, any tip and the total.",
        "Where the law of your market requires it, the service charge is included in the first price you see. A higher delivery fee in bad weather or at busy times is shown, with the reason, before you pay. Food prices and the service charge never change for these reasons, and prices are never personalised to you.",
        "If you pay in a different currency, the rate and our margin are shown before you pay and held for the time shown. After that you receive a new quote; the rate is never changed silently. See How pricing works.",
      ] },
      { h: "Paying", p: [
        "Payments are collected, converted and settled by licensed payment partners. Tunakula does not hold your money.",
        "Your Tunakula wallet keeps a separate balance in each currency. We never convert a balance without your explicit instruction.",
        "Cash on delivery is only available in markets where it has been specifically approved, and may be unavailable for some orders.",
      ] },
      { h: "Delivery and handover", p: [
        "Give an address a rider can find: a pin, the landmark, and a voice note if it helps. The rider will ask for your handover code; delivery is not complete until the code is confirmed, or another method you chose (such as contactless with a photo) is used.",
        "Gifts, cross-border orders and high-value orders always require the recipient's code. Age-restricted items are handed over only after the age check your market requires.",
        "If the person at the door is not you or your named recipient, the rider will not hand over the order.",
      ] },
      { h: "Cancelling and refunds", p: ["You can cancel free of charge until the merchant accepts the order. After that, see Refunds and cancellations, which also explains when you are refunded automatically."] },
      { h: "Reviews and conduct", p: ["You can rate the food and the delivery separately after a completed order. Please follow the Acceptable use policy; we do not tolerate abuse of riders, merchants or staff."] },
      { h: "Our responsibility to you", p: [
        "We provide the service with reasonable care and skill. Nothing in these terms limits rights you have under the consumer law of your country.",
        "[Limitation of liability and governing law to be drafted per market by counsel.]",
      ] },
      { h: "Changes and contact", p: ["We will tell you in the app before material changes to these terms take effect. Questions, complaints and requests: info@tunakula.com."] },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    audience: "Everyone",
    summary: "What personal data Tunakula collects, why, who sees it, where it is kept, and the rights you have.",
    sections: [
      { h: "Who is responsible", p: [ENTITY, "Write to info@tunakula.com for any privacy question or request."] },
      { h: "What we collect", p: [
        "Account: mobile number, name, email if you give it, language and country. Orders: what you ordered, from whom, when, and the delivery address — including pins, landmark descriptions and voice notes.",
        "Payments: the method, amount, currency and partner reference. Full card numbers are handled only by our payment partners; we do not store them.",
        "Location: your location while you use the app to find merchants and deliver your order; a rider's location only while they are on shift. Support conversations, reviews and photos you send us.",
        "Partners: identity and business documents, liveness selfies, vehicle and licence details, and payout account details, used to verify merchants and riders.",
      ] },
      { h: "Why we use it", p: [
        "To provide the service you asked for (contract): accounts, orders, payment, delivery, support.",
        "To prevent fraud and keep people safe (legitimate interests), including checks on accounts, payments, promotions and cash.",
        "To personalise what you see — only with your consent; switch it off and you see what is popular instead. To send marketing — only with your consent, per channel.",
        "To improve our models (delivery times, landmark resolution, fraud detection) on consented or pseudonymised data; if you opt out, your data leaves training sets within 30 days.",
      ] },
      { h: "Who sees it", p: [
        "The merchant sees your order, first name and what they need to prepare it. The rider sees what they need to deliver it; phone numbers are masked.",
        "Payment partners, identity-verification providers and messaging providers process data for us under contract. Authorities receive data only where the law requires it.",
        "We never sell personal data.",
      ] },
      { h: "Where it is kept", p: [
        "Data is held in regional data planes. UK and EU customers' data is kept in London (europe-west2). Data for other markets is kept where that market's law and legal opinion require.",
        "When data moves between countries — for example when you send a meal from London to Kinshasa — we use the transfer safeguards your country's law requires.",
      ] },
      { h: "How long we keep it", p: [
        "We keep data for as long as your account is active and then for the period each market's retention schedule sets. Financial records are kept for the period the law requires even after an account is deleted; they are then linked only to a pseudonymous identifier.",
        "Photos used as delivery evidence are kept only as long as the dispute window requires.",
      ] },
      { h: "Your rights", p: [
        "You can ask to see, correct, export or delete your data, object to some uses, and withdraw consent at any time. You can delete your account yourself in the app — see Delete your account.",
        "No decision with a significant effect on you — such as a permanent ban — is made by automated means without human review. When an AI assistant helps you, we tell you, and you can always ask for a person.",
        "You may complain to your data-protection authority (in the UK, the Information Commissioner's Office). We would like the chance to resolve it first: info@tunakula.com.",
      ] },
      { h: "Children", p: ["Tunakula is not intended for children under the age set by your market's law, and we do not knowingly collect their data."] },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    audience: "Website visitors",
    summary: "The small files and similar technologies our website and apps use, and how to control them.",
    sections: [
      { h: "Essential", p: ["Needed for the site to work: keeping you signed in, remembering your basket, your country and language, and protecting forms against abuse. These cannot be switched off."] },
      { h: "Preferences", p: ["Remember choices such as display currency and low-bandwidth mode."] },
      { h: "Measurement", p: ["Help us understand which pages work and where people get stuck. Set only with your consent, and measured on pseudonymous identifiers."] },
      { h: "Advertising", p: ["We do not use advertising cookies without your consent."] },
      { h: "Your choices", p: ["Change your choices at any time from the cookie settings link at the bottom of every page, or in your browser. Questions: info@tunakula.com."] },
    ],
  },
  {
    slug: "refunds",
    title: "Refunds and cancellations",
    audience: "Customers",
    summary: "When you can cancel, when you get money back automatically, and how quickly.",
    sections: [
      { h: "Cancelling", p: ["Cancel free of charge until the merchant accepts the order. After acceptance the kitchen may already be cooking; contact support from the order and we will help."] },
      { h: "Refunded automatically", p: [
        "Delivery failed for a reason that was not yours, or the order never arrived.",
        "An item was unavailable and you declined the substitution offered — that line is refunded. Substitutions are never made without your approval.",
        "The merchant rejected or cancelled the order.",
        "A weighed item cost less than estimated — the difference is refunded.",
      ] },
      { h: "Missing or wrong items", p: ["Report it from the order within the window shown. Each order carries its own evidence — the kitchen checklist, package count, seals, photos and handover record — so most claims are settled quickly without argument."] },
      { h: "What is refunded", p: ["The goods refunded, plus the service charge in the same proportion. The delivery fee is refunded when the delivery itself failed."] },
      { h: "Where the money goes", p: ["To your original payment method or to your Tunakula wallet in the same currency, as you choose. Wallet refunds are immediate; refunds to a payment method follow the partner's timing."] },
      { h: "Disagreeing with a decision", p: ["You can appeal any refund decision. Appeals are reviewed by someone other than the person or agent who made the original decision. Write to info@tunakula.com."] },
    ],
  },
  {
    slug: "send-home-terms",
    title: "Send a Meal Home terms",
    audience: "Payers and recipients",
    summary: "Extra terms for orders paid in one country and delivered in another.",
    sections: [
      { h: "How it works", p: ["You pay in your currency for an order delivered in another country. The merchant is paid in its own currency in its own market."] },
      { h: "The rate", p: ["Before you pay you see the rate, our margin and the total. The quote is held for the time shown; after that you receive a new one. Currency conversion is carried out by a licensed partner; we record the rate, margin and reference on your order."] },
      { h: "The recipient", p: ["The recipient needs no account. They receive a message in their language with a handover code. The code cannot be waived for a gifted order — not by the rider and not by support."] },
      { h: "Proof", p: ["When the order is delivered you receive the time, the distance from the delivery pin, confirmation of the code and, where taken, a photo."] },
      { h: "Refunds", p: ["If the order cannot be delivered, you are refunded in the currency you paid. See Refunds and cancellations."] },
      { h: "Checks", p: ["Above certain values we may ask you to verify your identity, as anti-money-laundering rules require. Sanctions screening is carried out by our licensed partners."] },
    ],
  },
  {
    slug: "pricing",
    title: "How pricing works",
    audience: "Everyone",
    summary: "The six rules behind every price on Tunakula, with the numbers.",
    sections: [
      { h: "The six rules", p: [
        "1. Merchants pay 0% commission on every order, on every channel.",
        "2. Customers pay a 10% service charge on the merchant's prices, shown as its own line.",
        "3. Riders keep 70% of the delivery fee actually charged, plus all tips.",
        "4. In the city, delivery costs 1.00 per kilometre up to 5.00, and that cap holds to 7 km.",
        "5. Beyond 7 km the fee rises by 30% for every further 8 km.",
        "6. Rural areas pay 75% of the city fee at every distance.",
      ] },
      { h: "In numbers", p: ["3 km costs 3.00, of which the rider receives 2.10. 8 to 15 km costs 6.50 (rider 4.55); 16 to 23 km costs 8.45 (rider 5.92); 24 to 31 km costs 10.98 (rider 7.69). Amounts are the group defaults in US dollars; each market publishes its own values in its own currency."] },
      { h: "Busy times and bad weather", p: ["The delivery fee — and only the delivery fee — may rise in a zone when it rains, during big events or when riders are scarce, up to a published maximum. You see that it applies, and why, before paying. The rider receives 70% of the higher fee. Surges are switched off in declared emergencies."] },
      { h: "What never happens", p: ["Prices are never personalised: the same zone at the same time gets the same prices. Merchants are asked to keep their Tunakula prices the same as their counter prices."] },
    ],
  },
  {
    slug: "food-safety",
    title: "Allergens and food safety",
    audience: "Customers",
    summary: "How allergen and dietary information works, and what merchants are responsible for.",
    sections: [
      { h: "Information from the merchant", p: ["Allergen, dietary and religious tags (such as vegetarian, vegan or halal) are supplied by the merchant as structured information, not free text, and are shown before you add an item to your basket."] },
      { h: "In the kitchen", p: ["When an order contains allergen requirements, the kitchen must acknowledge them before packing, label the order distinctly and pack it separately. No substitution is made on such an order."] },
      { h: "Notes are not guarantees", p: ["Anything that must be guaranteed — an allergy, no pork, no nuts — should be set as a requirement, not written in a note. Notes are passed on but are advisory."] },
      { h: "Who is responsible", p: ["Each merchant holds its own food-business registration and is responsible for preparing food safely. Where an official hygiene rating exists in your market, it is shown on the merchant's page."] },
      { h: "Age-restricted items", p: ["Where your market permits them at all, age-restricted items are handed over only after the required age check. If the check fails, the item is returned and refunded."] },
      { h: "Report a problem", p: ["Report any reaction or safety concern from the order, or write to info@tunakula.com. Allergen incidents are investigated every time."] },
    ],
  },
];
