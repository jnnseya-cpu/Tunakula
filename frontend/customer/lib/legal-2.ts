import type { Policy } from "./legal-types";

export const PARTNER_POLICIES: Policy[] = [
  {
    slug: "merchant-terms",
    title: "Merchant Terms",
    audience: "Restaurants, supermarkets, pharmacies and shops",
    summary: "The terms for selling on Tunakula: zero commission, payouts, verification, order integrity and your team.",
    sections: [
      { h: "Zero commission", p: ["Tunakula charges no commission on any order — online, at your counter (POS), at a self-service hub or by QR at the table. You receive 100% of the price of the goods you sell. The platform is funded by a service charge paid by the customer and by a share of the delivery fee."] },
      { h: "Price parity", p: ["In return, your prices on Tunakula must be no higher than your in-store prices for the same item, where the law of your market allows this commitment. Online-only mark-ups are detected automatically and lead first to coaching, then to reduced visibility, then to review."] },
      { h: "Optional extras", p: ["You may choose paid extras: sponsored placement (always labelled as sponsored), premium software tiers, and payment processing at the provider's cost plus a declared margin. None is ever deducted from a sale without your agreement."] },
      { h: "Getting paid", p: [
        "Payouts go to a mobile-money or bank account in the name of your verified business or owner, confirmed by a small test payment. Schedules (instant, daily or weekly) are set per market.",
        "Changing your payout account triggers re-verification and a short cooling-off period before the next payout.",
      ] },
      { h: "Verification and trust tiers", p: [
        "Joining is fully online: business registration, owner identity with a liveness check, photos and a short video taken inside the app at your premises, payout-name match, signed agreement and a supervised first order.",
        "New merchants start at a provisional tier with lower volume and longer payout cycles. Tiers rise with good performance and may fall after quality or integrity problems; the reason and an appeal route are always shown.",
      ] },
      { h: "Preparing orders", p: [
        "Confirm every line of the pick list, record the number of packages, label and seal each bag, and take the pack photo before marking an order ready.",
        "Acknowledge allergen requirements before packing. Never substitute an item without the customer's approval in the app.",
        "Food safety, licences and hygiene obligations remain yours; we record your evidence and expiry dates and ask for renewals.",
      ] },
      { h: "Printed documents", p: ["Receipts, labels, tickets and statements carry the Tunakula logo and your logo. Upload your logo from your business profile; until you do, your name is printed in its place."] },
      { h: "Your team", p: ["You may add any number of team members, each with a role (Owner, Manager, Cashier, Kitchen, Accountant, Marketing or your own), optionally limited to specific branches. Nobody can grant rights they do not hold, and every business keeps at least one owner. Every change is recorded."] },
      { h: "Your data", p: ["Your catalogue, prices, stock and sales history are yours. Export them at any time in open formats, without asking anyone."] },
      { h: "Suspension, appeals and leaving", p: ["Suspensions carry a reason code and evidence and can be appealed to a reviewer outside the team that raised them. You may close your business account at any time once orders are complete and balances settled; financial records are kept as the law requires."] },
    ],
  },
  {
    slug: "rider-terms",
    title: "Rider Terms",
    audience: "Riders and fleet partners",
    summary: "How work is offered, how you are paid, and the rules that protect you and the customer.",
    sections: [
      { h: "Your status", p: ["You work as a self-employed courier or through a fleet partner, according to the labour model that applies in your market. [Contract form to be confirmed per market by counsel.]"] },
      { h: "What you earn", p: [
        "You receive 70% of the delivery fee actually charged for each job, including distance band steps and any busy-time increase. Tips are 100% yours.",
        "A weekly performance bonus of 10% of your own delivery earnings is paid when you meet published criteria: completion, on-time rate, proof-of-delivery quality, customer rating and no confirmed integrity breach.",
        "Where your market sets a minimum earnings rule, it is applied and shown on your statement.",
      ] },
      { h: "Getting paid", p: ["Earnings are paid the same day to a mobile wallet or bank account in your own name, verified by a test payment."] },
      { h: "Offers and declining", p: [
        "Each offer shows what you will earn, the distance and the drop-off before you accept. You may decline any offer. Declines are never used for your pay, ranking, standing or the offers you receive.",
        "Every verified rider on shift receives a guaranteed minimum flow of offers in their zone. Good performance improves what you are offered, never whether you are offered anything.",
      ] },
      { h: "Handovers", p: ["Scan every package at pickup and at the door, hand over only to the right person after the code is confirmed, and complete the drop within the delivery area. If something cannot be verified, record the reason — never skip a step."] },
      { h: "Verification", p: ["Joining is fully online with identity, liveness, right-to-work and vehicle checks. Short random selfie checks may be requested at the start of or during a shift. Expired documents pause new shifts until renewed; everything else keeps working."] },
      { h: "Cash", p: ["Tunakula is cashless by default. Where cash on delivery has been approved in a market, cash must be deposited to the payment rail within the published deadline and stays within a per-currency cap; above the cap or after the deadline you receive prepaid jobs only."] },
      { h: "Safety and respect", p: ["Use the emergency button and trip sharing whenever you need them; phone numbers are masked. Report abuse by customers or merchants — reporting never affects your standing. Customers never see a public star rating of you."] },
      { h: "Appeals", p: ["Any score, standing or suspension can be appealed, with the order evidence attached automatically, to a reviewer independent of the original decision."] },
    ],
  },
];

export const PLATFORM_POLICIES: Policy[] = [
  {
    slug: "reviews",
    title: "Reviews and moderation",
    audience: "Everyone",
    summary: "How ratings are collected, scored and moderated — and why nobody is scored for someone else's failure.",
    sections: [
      { h: "Verified orders only", p: ["A rating can only exist for a real, completed and paid order. There is no way to submit a review without one, and nothing of value is ever offered in exchange for a rating."] },
      { h: "Two separate scores", p: ["Customers rate the food and the delivery separately; the two are never blended into one number. Riders and merchants rate each other privately. Customers are never given a public score."] },
      { h: "How the score is calculated", p: ["A merchant's public score is the median of its rated orders over the last 400 orders or 12 months, whichever comes first, with recent orders weighted more. No score is shown until a branch has 10 rated orders; until then it shows as new. Scores belong to the branch that cooked the food."] },
      { h: "Fairness", p: ["A late rider never lowers the kitchen's score, and a slow kitchen never lowers the rider's. Wrong addresses, severe weather and platform outages are excluded automatically."] },
      { h: "What we remove", p: ["Comments that are abusive, discriminatory, defamatory, reveal personal data or are about Tunakula rather than the merchant or rider. Negative reviews are never hidden, delayed or down-weighted otherwise, and every removal is logged with its reason."] },
      { h: "Replies", p: ["Merchants may reply within 30 days. Replies that blame a rider, attack the customer, reveal personal data or point to another platform are returned with a reason."] },
      { h: "Disputes", p: ["Anyone rated may dispute a rating with evidence; an upheld appeal removes it from the score immediately. Merchants, their staff, riders and our employees cannot review businesses they are connected to."] },
    ],
  },
  {
    slug: "ranking",
    title: "Ranking and allocation",
    audience: "Merchants, riders and customers",
    summary: "The main parameters that decide where merchants appear and which jobs reach riders.",
    sections: [
      { h: "Merchant ranking — primary", p: ["The food score (median), the rate of missing or wrong items, preparation time against the promise, acceptance and cancellation, and being open when the app says you are open."] },
      { h: "Merchant ranking — secondary", p: ["Handover readiness and packaging, realistic delivery time to this customer, menu completeness and photo quality, price position, and how often customers come back. New merchants receive a defined introduction period of assured exposure."] },
      { h: "Never a ranking input", p: ["Commission (there is none), advertising spend, subscription or software tier, anything a merchant did not control, and protected characteristics or proxies for them."] },
      { h: "Sponsored results", p: ["Sponsored placements sit in separate, limited and labelled slots, are charged per resulting order, are never sold to merchants below the quality standard, and never presented as a measure of quality."] },
      { h: "Rider allocation", p: ["Inputs: completion rate, on-time rate with merchant delays and traffic excluded, proof-of-delivery quality, the private customer delivery score, integrity record, and modest recognition of tenure. Never: decline rate, speed beyond safe travel, hours beyond safety limits, tips or protected characteristics. Every compliant rider receives a guaranteed minimum flow of offers, and the advantage from high standing is capped."] },
      { h: "Changes and appeals", p: ["Material changes are announced to business users in advance with the reason. Every standing carries a plain-language explanation, and any input can be appealed."] },
    ],
  },
  {
    slug: "acceptable-use",
    title: "Acceptable use",
    audience: "Everyone",
    summary: "What is not allowed on Tunakula, and what happens if it occurs.",
    sections: [
      { h: "Not allowed", p: [
        "Fraud: fake orders, false claims, chargeback abuse, promotion or referral farming, and using someone else's payment method.",
        "Abuse: harassment, threats, discrimination or violence toward riders, merchants, customers or staff.",
        "Manipulation: fake or incentivised reviews, self-reviews, and collusion between accounts.",
        "Account misuse: sharing, selling or renting an account, or using another person's identity.",
        "Prohibited items and any listing, image or text that is illegal or misleading — including AI-generated food photos presented as real dishes.",
      ] },
      { h: "Off-platform arrangements", p: ["Payments, discounts, refunds and agreements made outside Tunakula have no standing in disputes or settlement."] },
      { h: "What happens", p: ["Depending on severity: a warning, limits, suspension or closure. Significant decisions such as permanent bans are always reviewed by a person and can be appealed."] },
      { h: "Report it", p: ["Report from the order or the profile in the app, or write to info@tunakula.com. Reporting abuse never counts against you."] },
    ],
  },
  {
    slug: "delete-account",
    title: "Delete your account",
    audience: "Everyone",
    summary: "How to close a personal or business account, what is deleted and what the law requires us to keep.",
    sections: [
      { h: "How", p: ["Open your profile and choose Delete account. If something must be settled first, the app tells you exactly what: an open order, money owed to or by you, or — for a business — being its only owner."] },
      { h: "A 30-day window", p: ["Deletion is scheduled 30 days ahead and can be cancelled during that time. A business account cannot be changed while deletion is pending."] },
      { h: "What is deleted", p: ["Your profile picture and cover picture, your name, phone number and email, and every role you hold in business accounts."] },
      { h: "What is kept", p: ["Orders and financial records the law requires us to keep, linked only to a pseudonymous identifier. A business keeps its legal name on past invoices. Deleting your personal account never deletes a business you belong to."] },
    ],
  },
];

export const COMPANY_POLICIES: Policy[] = [
  {
    slug: "accessibility",
    title: "Accessibility statement",
    audience: "Everyone",
    summary: "Our accessibility commitments and how to tell us when something does not work for you.",
    sections: [
      { h: "Our standard", p: ["We design the website to WCAG 2.2 level AA and the apps to equivalent practice: screen-reader support, adjustable text size, sufficient contrast, large touch targets, no reliance on colour alone, and no time limit that cannot be extended."] },
      { h: "Built for how people order here", p: ["Voice ordering and read-aloud, WhatsApp ordering for people without a smartphone app, low-bandwidth mode, and saved delivery preferences such as 'call on arrival' honoured on every order."] },
      { h: "Known limitations", p: ["[To be completed after the first full assistive-technology audit before launch.]"] },
      { h: "Tell us", p: ["If anything is hard to use, write to info@tunakula.com and say what you were trying to do. We will reply and fix it."] },
    ],
  },
  {
    slug: "security",
    title: "Security and responsible disclosure",
    audience: "Researchers",
    summary: "How to report a security vulnerability to Tunakula.",
    sections: [
      { h: "Report", p: ["Email info@tunakula.com with 'Security' in the subject, a description, steps to reproduce and the impact. Please give us reasonable time to fix the issue before disclosing it."] },
      { h: "Please don't", p: ["Access or change other people's data, disrupt the service, run denial-of-service or social-engineering tests, or use automated scanning that degrades the platform."] },
      { h: "Our commitment", p: ["We acknowledge reports, keep you informed, and will not take action against good-faith research that follows this policy. [Safe-harbour wording to be confirmed by counsel.]"] },
    ],
  },
  {
    slug: "legal-notice",
    title: "Legal notice",
    audience: "Everyone",
    summary: "Who operates Tunakula and how to reach us.",
    sections: [
      { h: "Operator", p: ["Tunakula is a Groupe Nseya platform, operated on NZELA-OS."] },
      { h: "Companies by market", p: ["[For each market: the legal entity, registration number, registered address, directors and any licences — to be completed before launch.]"] },
      { h: "Payments", p: ["Payments are collected, converted and settled by licensed payment partners. Tunakula does not hold customer funds."] },
      { h: "Contact", p: ["info@tunakula.com — the single inbox for customers, partners, press, privacy and legal requests.", "Website: https://www.tunakula.com"] },
    ],
  },
];
