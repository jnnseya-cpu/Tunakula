/**
 * The feature playbook — one article per Tunakula capability, each selling it with its USP. Bilingual
 * (Français primary for the DRC, English second); Lingála/Kiswahili viewers fall back to French. Pure data,
 * imported by the static-exported /blog pages and localised client-side (see components/blog.tsx).
 */
export type Audience = "eaters" | "merchants" | "riders" | "operators";

export interface Loc {
  readonly title: string;
  readonly dek: string;
  readonly body: readonly string[];
  readonly usp: string;
}
export interface Article {
  readonly slug: string;
  readonly audience: Audience;
  readonly category: string;
  readonly fr: Loc;
  readonly en: Loc;
}

export const AUDIENCES: readonly { key: Audience; fr: string; en: string }[] = [
  { key: "eaters", fr: "Pour les clients", en: "For eaters" },
  { key: "merchants", fr: "Pour les restaurants & commerces", en: "For restaurants & shops" },
  { key: "riders", fr: "Pour les livreurs", en: "For riders" },
  { key: "operators", fr: "Pour les opérateurs", en: "For owners & operators" },
];

/** Where each audience's article should send the reader next. */
export const CTA: Record<Audience, { href: string; fr: string; en: string }> = {
  eaters: { href: "/order/", fr: "Commander maintenant", en: "Start an order" },
  merchants: { href: "/restaurants/apply/", fr: "Ouvrir ma boutique", en: "Open a storefront" },
  riders: { href: "/riders/", fr: "Livrer avec Tunakula", en: "Ride with Tunakula" },
  operators: { href: "/order/", fr: "Voir la plateforme", en: "See the platform" },
};

export const ARTICLES: readonly Article[] = [
  // ─────────────── EATERS ───────────────
  {
    slug: "prix-du-comptoir", audience: "eaters", category: "Prix",
    fr: {
      title: "Les prix du comptoir, pas des menus gonflés",
      dek: "Le même plat coûte ce qu'il coûte au comptoir du restaurant.",
      body: [
        "Sur la plupart des applications de livraison, le restaurant paie une commission de 25 à 30 % sur chaque commande. Pour s'en sortir, il augmente ses prix dans l'application. Vous payez donc votre moambe ou vos brochettes plus cher en ligne qu'au comptoir — sans le savoir.",
        "Chez Tunakula, le restaurant ne paie aucune commission. Il garde le prix que vous connaissez déjà. Notre charge de service de 10 % apparaît sur sa propre ligne, à côté de la livraison : rien n'est caché, et vous voyez exactement où va chaque franc.",
      ],
      usp: "Le même repas, à 3 km, vous coûte simplement moins cher que sur une application à commission.",
    },
    en: {
      title: "Counter prices, not marked-up menus",
      dek: "The same dish costs what it costs at the restaurant's own counter.",
      body: [
        "On most delivery apps the restaurant pays a 25–30% commission on every order. To survive it, they raise their in-app prices. So you quietly pay more for your moambe or brochettes online than you would at the counter.",
        "On Tunakula the restaurant pays zero commission. They keep the price you already know. Our 10% service charge shows on its own line, next to delivery — nothing hidden, and you see exactly where every franc goes.",
      ],
      usp: "The same meal, 3 km away, simply costs you less than on a commission app.",
    },
  },
  {
    slug: "suivi-en-direct", audience: "eaters", category: "Livraison",
    fr: {
      title: "Suivez votre livreur. Déverrouillez avec un code.",
      dek: "Suivi en direct sur la carte, et un code à quatre chiffres à votre porte.",
      body: [
        "Dès que votre commande part, vous suivez le livreur en temps réel sur la carte — vous voyez la distance et le temps qui reste, sans rappeler dix fois.",
        "La commande n'est marquée livrée qu'une fois que vous donnez votre code à quatre chiffres. Votre repas arrive donc à vous, pas à un voisin ni au gardien du portail. C'est une preuve de livraison qui protège le client, pas seulement la plateforme.",
      ],
      usp: "Une preuve de livraison qui protège d'abord le client.",
    },
    en: {
      title: "Watch your rider. Unlock with a code.",
      dek: "Live tracking on the map, and a four-digit code at your door.",
      body: [
        "The moment your order leaves, you follow the rider in real time on the map — you see the distance and the minutes left, without calling ten times.",
        "The order is only marked delivered once you give your four-digit code. So your food reaches you, not a neighbour or the gate guard. It's proof-of-delivery built to protect the customer, not just the platform.",
      ],
      usp: "Proof-of-delivery that protects the customer first.",
    },
  },
  {
    slug: "mobile-money", audience: "eaters", category: "Paiement",
    fr: {
      title: "Payez comme Kinshasa paie",
      dek: "M-Pesa, Orange Money, Airtel Money, Afrimoney ou carte — en francs ou en dollars.",
      body: [
        "Chaque grand portefeuille mobile est accepté : M-Pesa, Orange Money, Airtel Money et Afrimoney, en plus des cartes. Vous choisissez votre opérateur et votre monnaie — francs congolais ou dollars.",
        "Le total complet s'affiche avant que vous validiez : plat, livraison et charge de service, chacun sur sa ligne. Aucune surprise au moment de payer, et personne n'est bloqué parce qu'il est sur le « mauvais » réseau.",
      ],
      usp: "Personne n'est exclu parce qu'il est sur le mauvais réseau.",
    },
    en: {
      title: "Pay the way Kinshasa pays",
      dek: "M-Pesa, Orange Money, Airtel Money, Afrimoney or card — in francs or dollars.",
      body: [
        "Every major mobile wallet is accepted: M-Pesa, Orange Money, Airtel Money and Afrimoney, plus cards. You pick your operator and your currency — Congolese francs or dollars.",
        "The full total shows before you approve: food, delivery and service charge, each on its own line. No surprises at payment, and nobody is locked out for being on the \"wrong\" network.",
      ],
      usp: "Nobody is locked out because they're on the wrong network.",
    },
  },
  {
    slug: "options-et-supplements", audience: "eaters", category: "Votre repas",
    fr: {
      title: "Options et suppléments, chiffrés en direct",
      dek: "Plus de fromage, une plus grande taille, sans piment — c'est vous qui décidez.",
      body: [
        "Les plats portent de vraies options et des suppléments payants. Choisissez la taille, ajoutez un accompagnement, retirez le piment : le prix se met à jour pendant que vous composez.",
        "Vous regardez le total monter au fur et à mesure, donc l'addition ne réserve aucune surprise. La commande est exactement ce que vous vouliez, au prix que vous avez vu s'additionner.",
      ],
      usp: "La commande est exactement ce que vous vouliez, au prix que vous avez vu s'additionner.",
    },
    en: {
      title: "Add-ons & choices, priced live",
      dek: "Extra cheese, a bigger size, no piment — your call.",
      body: [
        "Dishes carry real options and paid add-ons. Pick the size, add a side, leave out the piment — the price updates as you build the order.",
        "You watch the total climb as you go, so the bill holds no surprises. The order is exactly what you wanted, at a price you watched add up.",
      ],
      usp: "The order is exactly what you wanted, at a price you watched add up.",
    },
  },
  {
    slug: "commandes-groupees", audience: "eaters", category: "Ensemble",
    fr: {
      title: "Des commandes groupées qui partagent l'addition",
      dek: "Partagez un lien ; chacun ajoute ses propres plats.",
      body: [
        "Lancez un panier groupé pour le bureau ou la famille et partagez le lien. Chaque personne choisit elle-même ce qu'elle veut manger.",
        "À la fin, le total se répartit proprement — personne ne court après les francs de ses collègues le lendemain. C'est ce qui transforme une application de déjeuner solo en déjeuner de toute l'équipe.",
      ],
      usp: "La fonction qui transforme le déjeuner solo en déjeuner de toute l'équipe.",
    },
    en: {
      title: "Group orders that split the bill",
      dek: "Share a link; everyone adds their own dishes.",
      body: [
        "Start a group basket for the office or the family and share the link. Each person picks their own food.",
        "At the end the total splits cleanly — nobody chases their colleagues for francs the next day. It's what turns a solo lunch app into the whole team's lunch.",
      ],
      usp: "The feature that turns a solo lunch app into the whole team's lunch.",
    },
  },
  {
    slug: "reserver-un-chef", audience: "eaters", category: "Nouveau · premium",
    fr: {
      title: "Réservez un chef à votre table",
      dek: "Un dîner privé, de la préparation de repas, un événement — ou une simple consultation cuisine.",
      body: [
        "Parcourez des chefs approuvés par cuisine et par commune. Vous voyez d'abord le devis complet : les honoraires du chef plus notre charge de service de 10 %, sur des lignes séparées. Le chef garde chaque franc de ses honoraires.",
        "Que ce soit un dîner congolais chez vous, la préparation des repas de la semaine ou une classe de cuisine, tout se réserve et se règle de la même façon qu'une commande ordinaire — 0 % de commission, le chef payé en entier.",
      ],
      usp: "Une seconde activité — la gastronomie à domicile — qu'aucun rival de Kinshasa ne propose dans une application de livraison.",
    },
    en: {
      title: "Book a chef to your table",
      dek: "A private dinner, meal prep, an event — or a quick cooking consultation.",
      body: [
        "Browse approved chefs by cuisine and commune. You see the full quote first: the chef's fee plus our 10% service charge, on separate lines. The chef keeps every franc of their fee.",
        "Whether it's a Congolese dinner at home, the week's meal prep or a cooking class, it all books and settles the same way an ordinary order does — 0% commission, the chef paid in full.",
      ],
      usp: "A second business — fine dining at home — no Kinshasa rival runs inside a delivery app.",
    },
  },
  {
    slug: "envoyer-un-repas", audience: "eaters", category: "Diaspora",
    fr: {
      title: "Envoyez un repas à Maman",
      dek: "Payez depuis Londres, Paris ou Bruxelles ; elle mange ce soir à Kinshasa.",
      body: [
        "Payez en livres, en euros ou en dollars depuis l'étranger. Une cuisine de Kinshasa prépare le repas, un livreur l'apporte, elle confirme avec le code, et vous recevez la photo.",
        "C'est la façon la plus directe pour la diaspora congolaise de prendre soin des siens au pays — un vrai repas chaud, pas un virement qu'il faut encore aller dépenser.",
      ],
      usp: "Cela transforme la diaspora congolaise en clients — un marché qu'aucun rival local n'atteint.",
    },
    en: {
      title: "Send a meal home to Maman",
      dek: "Pay from London, Paris or Brussels; she eats tonight in Kinshasa.",
      body: [
        "Pay in pounds, euros or dollars from abroad. A Kinshasa kitchen cooks it, a rider brings it, she confirms with the code, and you get the photo.",
        "It's the most direct way for the Congolese diaspora to look after family back home — a real hot meal, not a transfer someone still has to go and spend.",
      ],
      usp: "It turns the Congolese diaspora into customers — a market no local rival reaches.",
    },
  },
  {
    slug: "fidelite-et-recompenses", audience: "eaters", category: "Fidélité",
    fr: {
      title: "Des récompenses qui reviennent vraiment",
      dek: "Points de fidélité, cashback, coupons, parrainage et un portefeuille.",
      body: [
        "Gagnez des points à chaque commande, invitez un ami pour une réduction sur sa première commande, et gardez du crédit dans un portefeuille utilisable d'un restaurant à l'autre.",
        "Les abonnements Tunakula Plus réduisent la livraison pour les habitués. C'est une vraie boîte à outils de fidélisation, pas une carte à tampons — faire de la commande répétée une habitude.",
      ],
      usp: "Une vraie boîte à outils de fidélisation, pas un gadget — pour ancrer l'habitude de recommander.",
    },
    en: {
      title: "Rewards that actually come back",
      dek: "Loyalty points, cashback, coupons, referrals and a wallet.",
      body: [
        "Earn points on every order, invite a friend for a discount on their first order, and keep credit in a wallet you can spend across restaurants.",
        "Tunakula Plus memberships cut delivery for regulars. It's a real retention toolkit, not a stamp card — making repeat ordering the habit.",
      ],
      usp: "A full retention toolkit, not a gimmick — to make repeat ordering the habit.",
    },
  },
  {
    slug: "quatre-langues", audience: "eaters", category: "Langue",
    fr: {
      title: "Dans votre langue, dès le départ",
      dek: "Français, English, Lingála et Kiswahili — d'un seul geste.",
      body: [
        "La boutique parle quatre langues : le français par défaut, puis l'anglais, le lingála et le kiswahili. Changez de langue et toute l'interface suit.",
        "Les noms des plats sont traduits séparément par chaque restaurant, pour que « poulet à la moambe » reste juste dans chaque langue. On rencontre chaque client là où il est.",
      ],
      usp: "Une plateforme qui parle réellement la langue de la rue, pas seulement le français d'affaires.",
    },
    en: {
      title: "In your language, from the start",
      dek: "Français, English, Lingála and Kiswahili — one tap.",
      body: [
        "The storefront speaks four languages: French by default, then English, Lingála and Kiswahili. Switch and the whole interface follows.",
        "Dish names are translated separately by each restaurant, so \"poulet à la moambe\" reads right in every language. We meet each customer where they are.",
      ],
      usp: "A platform that truly speaks the language of the street, not just business French.",
    },
  },

  // ─────────────── MERCHANTS ───────────────
  {
    slug: "zero-commission", audience: "merchants", category: "La promesse",
    fr: {
      title: "0 % de commission. Pour toujours.",
      dek: "Chaque commande, chaque franc de votre prix de carte — à vous.",
      body: [
        "Aucune ponction par commande. Vous gardez le prix de comptoir que vos clients connaissent déjà. La charge de service qui finance la plateforme est payée par le client, en toute transparence.",
        "La marge qu'une application à 25–30 % de commission vous prend, c'est exactement la marge que vous gardez ici. Sur le volume d'un mois, l'écart paie un employé de plus.",
      ],
      usp: "La marge qu'une application à commission vous prend, c'est la marge que vous gardez ici.",
    },
    en: {
      title: "0% commission. Forever.",
      dek: "Every order, every franc of your menu price — yours.",
      body: [
        "No per-order cut. You keep the counter price your customers already know. The service charge that funds the platform is paid by the customer, transparently.",
        "The margin a 25–30% commission app takes is exactly the margin you keep here. Over a month's volume, that gap pays for another member of staff.",
      ],
      usp: "The margin a commission app takes is exactly the margin you keep here.",
    },
  },
  {
    slug: "boutique-en-libre-service", audience: "merchants", category: "Inscription",
    fr: {
      title: "Votre boutique en quelques minutes, par vous-même",
      dek: "Téléphone, un code, le nom de l'affaire, quelques plats — en ligne.",
      body: [
        "Un assistant guidé en libre-service : connectez-vous avec votre numéro, nommez votre affaire, ajoutez votre établissement et votre carte avec photos et suppléments, puis publiez.",
        "Pas de commercial à attendre, pas de délai de 48 heures. C'est une inscription qu'un patron occupé termine entre deux commandes du midi — pas un formulaire qu'il abandonne.",
      ],
      usp: "Une inscription qu'un patron occupé termine entre deux commandes, pas un formulaire abandonné.",
    },
    en: {
      title: "Your storefront in minutes, by yourself",
      dek: "Phone, one code, business name, a few dishes — live.",
      body: [
        "A guided self-serve wizard: sign in with your number, name your business, add your branch and menu with photos and add-ons, then publish.",
        "No sales rep to wait for, no 48-hour delay. It's onboarding a busy owner finishes between lunch orders — not a form they abandon.",
      ],
      usp: "Onboarding a busy owner finishes between lunch orders, not a form they abandon.",
    },
  },
  {
    slug: "caisse-sur-telephone", audience: "merchants", category: "Caisse",
    fr: {
      title: "Une caisse sur le téléphone que vous avez déjà",
      dek: "Espèces, mobile money, addition partagée — et ça marche hors ligne.",
      body: [
        "Prenez les commandes au comptoir et à table sur le même appareil. Aucun matériel à acheter, aucun nouveau terminal.",
        "Tout arrive dans les mêmes livres que vos commandes en livraison : un seul système pour le comptoir et pour la livraison, au lieu d'une caisse ici et d'une application là.",
      ],
      usp: "Un seul système pour le comptoir et la livraison, au lieu d'une caisse ici et d'une application là.",
    },
    en: {
      title: "A POS on the phone you already own",
      dek: "Cash, mobile money, split bills — and it works offline.",
      body: [
        "Take walk-in and table orders on the same device. No hardware to buy, no new terminal.",
        "Everything lands in the same books as your delivery orders: one system for the counter and for delivery, instead of a till here and an app there.",
      ],
      usp: "One system for the counter and delivery, instead of a till here and an app there.",
    },
  },
  {
    slug: "ecran-de-cuisine", audience: "merchants", category: "Cuisine",
    fr: {
      title: "Un écran de cuisine qui fait avancer la file",
      dek: "Les tickets sur un écran, validés au fur et à mesure.",
      body: [
        "Un tableau de cuisine dédié (avec un mode « bump ») affiche les commandes qui entrent, et le personnel fait avancer chacune — accepter, préparer, emballer.",
        "Rien ne se perd sur un bout de papier dans une cuisine surchauffée. C'est un vrai logiciel de cuisine, pas une sonnette — moins de commandes oubliées et en retard.",
      ],
      usp: "Un vrai logiciel de cuisine, pas une sonnette — moins de commandes oubliées et en retard.",
    },
    en: {
      title: "A kitchen display that keeps the line moving",
      dek: "Tickets on a screen, bumped as they're done.",
      body: [
        "A dedicated kitchen board (with a bump mode) shows incoming orders, and staff advance each one — accept, prepare, pack.",
        "Nothing is lost on a paper slip in a hot kitchen. It's real kitchen software, not a buzzer — fewer missed and late orders.",
      ],
      usp: "Real kitchen software, not a buzzer — fewer missed and late orders.",
    },
  },
  {
    slug: "kiosque-et-qr-table", audience: "merchants", category: "Sur place",
    fr: {
      title: "Kiosque en libre-service & QR à table",
      dek: "Les clients commandent et paient depuis un kiosque ou leur propre téléphone.",
      body: [
        "Posez un kiosque en libre-service près de la porte ou un QR code sur chaque table. Les gens commandent et paient eux-mêmes.",
        "Pas de personnel en plus, des files plus courtes, des paniers plus gros. La même plateforme fait tourner votre salle, pas seulement la livraison.",
      ],
      usp: "La même plateforme fait tourner votre salle, pas seulement la livraison.",
    },
    en: {
      title: "Self-order kiosk & table QR",
      dek: "Customers order and pay from a kiosk or their own phone.",
      body: [
        "Put a self-order kiosk by the door or a QR code on every table. People order and pay themselves.",
        "No extra staff, shorter queues, bigger baskets. The same platform runs your dine-in floor, not only delivery.",
      ],
      usp: "The same platform runs your dine-in floor, not only delivery.",
    },
  },
  {
    slug: "epiceries-et-pharmacies", audience: "merchants", category: "Au-delà des restaurants",
    fr: {
      title: "Épiceries, pharmacies & commerces aussi",
      dek: "On parcourt par rayon, avec étiquettes d'unité et formats.",
      body: [
        "Les commerces non-restaurants reçoivent une présentation de boutique : les catégories en rayons, des étiquettes « 1 kg / 500 ml / pack de 6 », et les produits à âge réglementé signalés.",
        "Une seule plateforme pour le repas et les produits du quotidien. Vous captez tout le panier — le dîner et la lessive — dans une seule commande.",
      ],
      usp: "Vous captez tout le panier — le dîner et la lessive — dans une seule commande.",
    },
    en: {
      title: "Groceries, pharmacies & shops too",
      dek: "Browse by aisle, with unit labels and pack sizes.",
      body: [
        "Non-restaurant stores get a shop layout: categories as aisles, \"1 kg / 500 ml / 6-pack\" labels, and age-restricted items flagged.",
        "One platform for food and everyday goods. You capture the whole basket — dinner and the washing powder — in one order.",
      ],
      usp: "You capture the whole basket — dinner and the washing powder — in one order.",
    },
  },
  {
    slug: "copilote-marchand", audience: "merchants", category: "Copilote IA",
    fr: {
      title: "Un copilote qui rédige et conseille",
      dek: "Descriptions de plats, réponses aux avis, et des analyses en langage clair.",
      body: [
        "Le copilote marchand rédige et traduit les textes de votre carte, propose une réponse à un avis client, et vous dit ce qui se vend — par établissement, en mots, pas en tableurs.",
        "C'est l'aide marketing qu'une petite cuisine ne peut pas embaucher, intégrée et gratuite à l'usage.",
      ],
      usp: "L'aide marketing qu'une petite cuisine ne peut pas embaucher, intégrée et gratuite.",
    },
    en: {
      title: "A copilot that writes and advises",
      dek: "Dish descriptions, review replies, and plain-language insights.",
      body: [
        "The merchant copilot drafts and translates your menu copy, suggests a reply to a customer review, and tells you what's selling — per branch, in words, not spreadsheets.",
        "It's the marketing help a small kitchen can't hire, built in and free to use.",
      ],
      usp: "The marketing help a small kitchen can't hire, built in and free to use.",
    },
  },
  {
    slug: "franchise", audience: "merchants", category: "Grandir",
    fr: {
      title: "Franchisez avec un code d'invitation",
      dek: "Partagez un code ; chaque point de vente gère son établissement sous votre marque.",
      body: [
        "Les propriétaires de marque invitent des franchisés qui s'inscrivent eux-mêmes et gèrent leur propre établissement, carte et horaires — le tout sous un seul nom.",
        "Les paiements et les relevés sont propres, établissement par établissement. Vous passez d'une cuisine à une chaîne sans rien reconstruire.",
      ],
      usp: "Passez d'une cuisine à une chaîne sans rien reconstruire.",
    },
    en: {
      title: "Franchise with an invite code",
      dek: "Share one code; each location runs its own branch under your brand.",
      body: [
        "Brand owners invite franchisees who sign up on their own and manage their own branch, menu and hours — all under one name.",
        "Payouts and statements stay clean, branch by branch. You scale from one kitchen to a chain without rebuilding anything.",
      ],
      usp: "Scale from one kitchen to a chain without rebuilding anything.",
    },
  },
  {
    slug: "paiements-et-releves", audience: "merchants", category: "Argent",
    fr: {
      title: "Paiements et relevés dans lesquels vous avez confiance",
      dek: "Ce que vous avez gagné, clairement, avec export pour la compta.",
      body: [
        "Chaque commande, chaque charge de service et chaque paiement sont tracés. Vos relevés de gains montrent exactement ce qui vous revient, établissement par établissement.",
        "Exportez les commandes et les paiements en CSV pour votre comptable. La transparence, pas une boîte noire qui décide de votre argent.",
      ],
      usp: "La transparence de bout en bout, pas une boîte noire qui décide de votre argent.",
    },
    en: {
      title: "Payouts and statements you can trust",
      dek: "What you earned, clearly, with an export for the books.",
      body: [
        "Every order, service charge and payout is traced. Your earnings statements show exactly what's owed to you, branch by branch.",
        "Export orders and payouts to CSV for your accountant. Transparency, not a black box deciding your money.",
      ],
      usp: "End-to-end transparency, not a black box deciding your money.",
    },
  },

  // ─────────────── RIDERS ───────────────
  {
    slug: "voir-la-paie-avant", audience: "riders", category: "Équité",
    fr: {
      title: "Voyez la distance et la paie d'abord",
      dek: "Chaque course affiche la distance et ce que vous gagnerez — avant d'accepter.",
      body: [
        "Pas d'acceptation à l'aveugle. Vous connaissez le point de retrait, la destination, la distance et le paiement à l'avance.",
        "Refuser une course ne vous coûte jamais la suivante. C'est la transparence et la dignité que les livreurs disent que les grandes applications leur ont retirées.",
      ],
      usp: "La transparence et la dignité que les grandes applications ont retirées aux livreurs.",
    },
    en: {
      title: "See the distance and the pay first",
      dek: "Every job shows how far and what you'll earn — before you accept.",
      body: [
        "No blind acceptances. You know the pickup, the drop, the distance and the payout up front.",
        "Turning a job down never costs you the next one. It's the transparency and dignity gig riders say the big apps took away.",
      ],
      usp: "The transparency and dignity gig riders say the big apps took away.",
    },
  },
  {
    slug: "paye-le-jour-meme", audience: "riders", category: "Argent",
    fr: {
      title: "Livrez aujourd'hui, soyez payé aujourd'hui",
      dek: "Paiement et versement d'espèces le jour même, pas une attente d'une semaine.",
      body: [
        "Vos gains sont à vous le jour même, avec la remise d'espèces gérée proprement et un relevé courant fiable.",
        "Votre argent bouge à la vitesse où vous travaillez — un flux de trésorerie qui colle à la vie réelle à Kinshasa : payé chaque jour, pas « un jour ».",
      ],
      usp: "Un flux de trésorerie qui colle à la vie réelle : payé chaque jour, pas un jour.",
    },
    en: {
      title: "Ride today, get paid today",
      dek: "Same-day payout and cash-in, not a weekly wait.",
      body: [
        "Your earnings are yours the same day, with cash hand-in handled cleanly and a running statement you can trust.",
        "Your money moves at the speed you work — cash flow that fits real life in Kinshasa: paid daily, not someday.",
      ],
      usp: "Cash flow that fits real life: paid daily, not someday.",
    },
  },
  {
    slug: "copilote-livreur", audience: "riders", category: "Copilote IA",
    fr: {
      title: "Un copilote pour votre service",
      dek: "Où être, ce que vous avez gagné, quand encaisser.",
      body: [
        "Le copilote livreur donne un aperçu de service en langage clair — les zones chargées, vos gains du moment, le bon moment pour encaisser.",
        "Tout est fondé sur vos propres chiffres, pas sur des suppositions. Il vous aide à gagner plus de l'heure, au lieu de seulement vous distribuer des courses.",
      ],
      usp: "Il vous aide à gagner plus de l'heure, au lieu de seulement vous distribuer des courses.",
    },
    en: {
      title: "A copilot for your shift",
      dek: "Where to be, what you've earned, when to cash out.",
      body: [
        "The rider copilot gives a plain-language shift outlook — busy zones, your earnings so far, the right time to cash out.",
        "It's grounded in your own numbers, not guesswork. It helps you earn more per hour, instead of just handing you jobs.",
      ],
      usp: "It helps you earn more per hour, instead of just handing you jobs.",
    },
  },
  {
    slug: "securite-livreur", audience: "riders", category: "Sécurité & bonus",
    fr: {
      title: "Quêtes, services et un SOS",
      dek: "Des bonus à atteindre, des services à réserver, de l'aide à un geste.",
      body: [
        "Gagnez des bonus sur des quêtes, réservez vos services à l'avance, et déclenchez un SOS si quelque chose tourne mal sur la route.",
        "La plateforme prend soin des gens qui livrent pour elle. Sécurité et perspective de gain intégrées — la raison pour laquelle les bons livreurs restent et vous recommandent.",
      ],
      usp: "Sécurité et perspective de gain intégrées — la raison pour laquelle les bons livreurs restent.",
    },
    en: {
      title: "Quests, shifts and an SOS",
      dek: "Bonuses to hit, shifts to book, help one tap away.",
      body: [
        "Earn bonuses on quests, reserve shifts in advance, and raise an SOS if something goes wrong on the road.",
        "The platform looks after the people delivering for it. Safety and upside built in — the reason good riders stay and recommend you.",
      ],
      usp: "Safety and upside built in — the reason good riders stay.",
    },
  },

  // ─────────────── OPERATORS ───────────────
  {
    slug: "nouveaux-marches", audience: "operators", category: "Expansion",
    fr: {
      title: "Lancez un nouveau pays sans code",
      dek: "Publiez un profil de marché validé — monnaie, zones, règles — et vous êtes en ligne.",
      body: [
        "Chaque marché est un profil que vous remplissez et publiez. Les monnaies (CDF, USD et d'autres), les communes, les mentions légales et les moyens de paiement sont de la configuration.",
        "Pas de nouveau build, pas de déploiement. Vous passez d'une ville au pays suivant en quelques jours, pas en un nouveau projet de développement.",
      ],
      usp: "D'une ville au pays suivant en quelques jours, pas en un nouveau projet de dev.",
    },
    en: {
      title: "Launch a new country without code",
      dek: "Publish a validated market profile — currency, zones, rules — and you're live.",
      body: [
        "Each market is a profile you fill in and publish. Currencies (CDF, USD and more), communes, legal terms and payment rails are configuration.",
        "No new build, no deployment. You go from one city to the next country in days, not another dev project.",
      ],
      usp: "From one city to the next country in days, not another dev project.",
    },
  },
  {
    slug: "identite-et-isolation", audience: "operators", category: "Confiance & identité",
    fr: {
      title: "Connexion par téléphone, pays cloisonnés",
      dek: "Un numéro suffit ; les données de chaque marché sont isolées au niveau de la base.",
      body: [
        "Pas de mots de passe — on se connecte avec un téléphone et un code à usage unique. Simple pour l'utilisateur, difficile à usurper.",
        "Les données de chaque pays sont cloisonnées par la sécurité au niveau des lignes, donc un marché ne peut jamais voir les enregistrements d'un autre. Défendable quand un régulateur ou un investisseur pose la question.",
      ],
      usp: "Sans friction pour l'utilisateur, et défendable quand un régulateur ou un investisseur interroge sur les données.",
    },
    en: {
      title: "Phone-only sign-in, countries walled off",
      dek: "One number is the account; each market's data is isolated at the database.",
      body: [
        "No passwords — sign in with a phone and a one-time code. Simple for the user, hard to spoof.",
        "Each country's data is fenced off by row-level security, so a market can never see another's records. Defensible when a regulator or investor asks.",
      ],
      usp: "Frictionless for users, and defensible when a regulator or investor asks about data.",
    },
  },
  {
    slug: "assistant-ia-support", audience: "operators", category: "Support IA",
    fr: {
      title: "Un agent de support de niveau 1, intégré",
      dek: "Il répond à partir de la commande du client et de vos règles — dans sa langue.",
      body: [
        "L'assistant IA traite les questions courantes « où est ma commande / comment marchent les remboursements », fondé sur la vraie commande et vos politiques.",
        "Si un modèle n'est pas disponible, il bascule sur un moteur interne fiable. C'est un support qui grandit avec les commandes sans grandir vos effectifs.",
      ],
      usp: "Un support qui grandit avec les commandes sans grandir vos effectifs.",
    },
    en: {
      title: "A tier-1 support agent, built in",
      dek: "Answers from the customer's own order and your rules — in their language.",
      body: [
        "The AI assistant handles routine \"where's my order / how do refunds work\" questions, grounded in the real order and your policies.",
        "If a model is unavailable, it falls back to a dependable in-house brain. It's support that scales with orders without scaling your headcount.",
      ],
      usp: "Support that scales with orders without scaling your headcount.",
    },
  },
  {
    slug: "agent-de-croissance", audience: "operators", category: "Moteur de croissance",
    fr: {
      title: "Un agent de croissance qui reconquiert les clients",
      dek: "Recommandations personnalisées et campagnes de reconquête, sous plafonds de dépense.",
      body: [
        "L'agent de croissance repère les clients qui s'éloignent et lance la reconquête automatiquement, avec un texte écrit pour chaque client.",
        "Des plafonds stricts garantissent qu'il ne dépasse jamais le budget. C'est la production d'une équipe marketing en pilote automatique, avec les garde-fous de budget intégrés.",
      ],
      usp: "La production d'une équipe marketing en pilote automatique, avec les garde-fous intégrés.",
    },
    en: {
      title: "A growth agent that wins customers back",
      dek: "Personalised recommendations and win-back campaigns, under spend caps.",
      body: [
        "The growth agent spots lapsing customers and runs re-engagement automatically, with copy written per customer.",
        "Hard caps ensure it never overspends. It's a marketing team's output on autopilot, with the budget guardrails built in.",
      ],
      usp: "A marketing team's output on autopilot, with the budget guardrails built in.",
    },
  },
  {
    slug: "integrations", audience: "operators", category: "Vos propres clés",
    fr: {
      title: "Vos paiements, SMS, cartes et IA — branchés",
      dek: "Ajoutez les clés des fournisseurs dans un panneau ; la plateforme fait le reste.",
      body: [
        "BitriPay, KODA, Stripe, Twilio, Google Routes, votre modèle d'IA — réglez les clés dans le panneau Intégrations, les variables d'environnement réelles ayant toujours la priorité et les secrets jamais réaffichés.",
        "Vous n'êtes jamais enfermé chez un fournisseur. Changez de prestataire de paiement ou de SMS sans reconstruire quoi que ce soit.",
      ],
      usp: "Jamais enfermé chez un fournisseur — changez de prestataire sans reconstruire.",
    },
    en: {
      title: "Your payment, SMS, maps and AI — plugged in",
      dek: "Add provider keys in one panel; the platform does the rest.",
      body: [
        "BitriPay, KODA, Stripe, Twilio, Google Routes, your AI model — set keys in the Integrations panel, with real environment variables always taking priority and secrets never shown back.",
        "You're never locked to one vendor. Swap a payment or SMS provider without rebuilding anything.",
      ],
      usp: "Never locked to one vendor — swap a provider without a rebuild.",
    },
  },
  {
    slug: "applications-natives", audience: "operators", category: "Portée",
    fr: {
      title: "Trois applications natives & une plateforme web",
      dek: "Applications client, livreur et restaurant, plus la boutique et la console d'admin.",
      body: [
        "Des applications natives pour les trois côtés du marché, une boutique web pour quiconque n'a pas l'application, et des notifications push sur iOS et Android derrière un seul jeton.",
        "Une console d'opérations complète pour votre équipe. Chaque côté de la place de marché a une application de premier plan dès le premier jour.",
      ],
      usp: "Chaque côté de la place de marché a une application de premier plan dès le premier jour.",
    },
    en: {
      title: "Three native apps & a full web platform",
      dek: "Eater, rider and restaurant apps, plus the storefront and admin console.",
      body: [
        "Native apps for all three sides of the market, a web storefront for anyone without the app, and push notifications across iOS and Android behind one token.",
        "A full operations console for your team. Every side of the marketplace has a first-class app on day one.",
      ],
      usp: "Every side of the marketplace has a first-class app on day one.",
    },
  },
];

export function articleBySlug(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
export function articlesFor(audience: Audience): Article[] {
  return ARTICLES.filter((a) => a.audience === audience);
}
