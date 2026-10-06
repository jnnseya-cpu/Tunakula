/**
 * Communication Event Architecture (PRD §-comms).
 *
 * One catalogue of every message the platform can send, fanning out across five channels
 * (email · in-app · SMS · push · WhatsApp) to the four audiences Tunakula serves — customers,
 * restaurants, riders and the console (admin/operations). This is the single source of truth:
 * the backend dispatches against it and the admin console renders it, so a channel or a mandatory
 * notice is defined once and can never drift between the two.
 *
 * `mandatory` events bypass a recipient's notification opt-outs — security, payment, legal, safety
 * and suspension notices that a person must receive even if they muted everything else.
 *
 * Subjects are the recipient-facing lines, French-first as on cd.tunakula.com, with `{{tokens}}`
 * filled at send time. They depend on nothing (ADR 0011: shared imports neither side).
 */

export type CommsChannel = "email" | "inapp" | "sms" | "push" | "whatsapp";
export type CommsSeverity = "info" | "success" | "warning" | "critical";
export type CommsAudience = "customer" | "restaurant" | "rider" | "admin";

export const COMMS_CHANNELS: readonly CommsChannel[] = ["email", "inapp", "sms", "push", "whatsapp"];
export const COMMS_AUDIENCES: readonly CommsAudience[] = ["customer", "restaurant", "rider", "admin"];

export interface CommsEvent {
  /** Stable machine key the backend emits, e.g. "order.delivered". */
  readonly key: string;
  /** Short label for the catalogue. */
  readonly title: string;
  /** Recipient-facing subject line (French-first), with {{tokens}}. */
  readonly subject: string;
  readonly severity: CommsSeverity;
  /** Bypasses the recipient's opt-outs when true. */
  readonly mandatory: boolean;
  readonly audience: readonly CommsAudience[];
  readonly channels: readonly CommsChannel[];
}

export interface CommsCategory {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly events: readonly CommsEvent[];
}

/** Terse constructor: e(key, title, subject, severity, audience, channels, mandatory?). */
const e = (
  key: string, title: string, subject: string, severity: CommsSeverity,
  audience: readonly CommsAudience[], channels: readonly CommsChannel[], mandatory = false,
): CommsEvent => ({ key, title, subject, severity, mandatory, audience, channels });

const C = ["customer"] as const, R = ["restaurant"] as const, D = ["rider"] as const, A = ["admin"] as const;
const inapp = ["inapp"] as const;
const email_inapp = ["email", "inapp"] as const;
const email_inapp_push = ["email", "inapp", "push"] as const;
const email_inapp_sms = ["email", "inapp", "sms"] as const;
const full_critical = ["email", "inapp", "sms", "push"] as const;

export const COMMS_CATALOGUE: readonly CommsCategory[] = [
  {
    key: "account", title: "Identity & account",
    description: "Sign-up and verification for customers, restaurants and riders.",
    events: [
      e("account.registration.requested", "Account requested", "Bienvenue sur Tunakula — confirmez votre compte", "info", ["customer", "restaurant", "rider"], email_inapp),
      e("account.otp_code", "Phone code", "Votre code Tunakula : {{code}}", "info", ["customer", "restaurant", "rider"], ["sms", "whatsapp", "inapp"], true),
      e("account.phone_verification_required", "Phone verification required", "Vérifiez votre numéro de téléphone", "warning", ["customer", "restaurant", "rider"], ["sms", "whatsapp", "inapp"]),
      e("account.email_verification_required", "Email verification required", "Vérifiez votre adresse e-mail", "warning", ["restaurant", "admin"], email_inapp),
      e("account.verification.successful", "Verification successful", "Votre compte est vérifié", "success", ["customer", "restaurant", "rider"], email_inapp),
      e("account.verification.failed", "Verification failed", "La vérification n'a pas abouti", "warning", ["customer", "restaurant", "rider"], email_inapp),
      e("account.verification.expired", "Verification expired", "Votre lien de vérification a expiré", "warning", ["customer", "restaurant", "rider"], email_inapp),
      e("account.welcome", "Welcome", "Bienvenue chez Tunakula, {{name}}", "success", C, email_inapp_push),
      e("account.profile_updated", "Profile updated", "Votre profil a été mis à jour", "info", ["customer", "restaurant", "rider"], inapp),
      e("account.registration.abandoned", "Registration abandoned", "Terminez la création de votre compte Tunakula", "info", C, email_inapp),
    ],
  },
  {
    key: "auth", title: "Login & security",
    description: "Sign-in, devices, passwords, two-factor and account locks.",
    events: [
      e("auth.login.success", "Successful login", "Nouvelle connexion à votre compte", "info", ["customer", "restaurant", "rider", "admin"], inapp),
      e("auth.login.failed", "Failed login", "Tentative de connexion échouée", "warning", ["restaurant", "admin"], inapp),
      e("auth.login.suspicious", "Suspicious login", "Connexion inhabituelle détectée", "critical", ["customer", "restaurant", "rider", "admin"], email_inapp_sms, true),
      e("auth.device.new", "New device", "Nouvel appareil connecté", "warning", ["customer", "restaurant", "rider", "admin"], email_inapp, true),
      e("password.forgot", "Forgot password", "Réinitialisez votre mot de passe Tunakula", "info", ["restaurant", "admin"], email_inapp),
      e("password.reset.successful", "Password reset", "Votre mot de passe a été réinitialisé", "success", ["restaurant", "admin"], email_inapp_sms, true),
      e("password.changed", "Password changed", "Votre mot de passe a été modifié", "success", ["restaurant", "admin"], email_inapp, true),
      e("mfa.enabled", "Two-factor enabled", "La double authentification est activée", "success", A, email_inapp, true),
      e("mfa.disabled", "Two-factor disabled", "La double authentification est désactivée", "warning", A, email_inapp_sms, true),
      e("security.alert", "Security alert", "Alerte de sécurité sur votre compte", "critical", ["customer", "restaurant", "rider", "admin"], email_inapp_sms, true),
      e("account.locked", "Account locked", "Votre compte a été verrouillé", "critical", ["customer", "restaurant", "rider", "admin"], email_inapp_sms, true),
      e("account.unlocked", "Account unlocked", "Votre compte est déverrouillé", "success", ["customer", "restaurant", "rider", "admin"], email_inapp),
      e("session.revoked", "Session revoked", "Une session a été déconnectée", "warning", ["restaurant", "admin"], email_inapp, true),
    ],
  },
  {
    key: "order_customer", title: "Orders — customer",
    description: "The order's journey as the customer sees it, from kitchen to door.",
    events: [
      e("order.placed", "Order placed", "Commande {{order}} envoyée à la cuisine", "success", C, ["inapp", "push", "whatsapp"]),
      e("order.accepted", "Order accepted", "{{restaurant}} a accepté votre commande", "info", C, ["inapp", "push", "whatsapp"]),
      e("order.preparing", "Being prepared", "Votre commande est en préparation", "info", C, ["inapp", "push"]),
      e("order.ready", "Ready", "Votre commande est prête", "info", C, ["inapp", "push"]),
      e("order.picked_up", "On the way", "{{rider}} a récupéré votre commande", "info", C, ["inapp", "push", "whatsapp"]),
      e("order.arriving", "Arriving", "Votre livreur arrive dans {{minutes}} min", "info", C, ["inapp", "push"]),
      e("order.delivered", "Delivered", "Commande {{order}} livrée — bon appétit", "success", C, ["inapp", "push", "whatsapp"]),
      e("order.door_code", "Door code", "Code de remise : {{code}}", "info", C, ["inapp", "push", "sms"], true),
      e("order.rejected", "Restaurant could not take it", "{{restaurant}} n'a pas pu prendre la commande", "warning", C, email_inapp_push),
      e("order.cancelled", "Cancelled", "Votre commande a été annulée", "warning", C, email_inapp_push),
      e("order.auto_cancelled", "Auto-cancelled", "Commande annulée faute de confirmation", "warning", C, email_inapp_push),
      e("order.delivery_failed", "Delivery failed", "La livraison n'a pas pu être effectuée", "warning", C, email_inapp_push, true),
      e("order.scheduled_reminder", "Scheduled order reminder", "Votre commande programmée arrive bientôt", "info", C, ["inapp", "push"]),
      e("order.review_request", "Rate your order", "Comment était votre commande ?", "info", C, ["inapp", "push"]),
    ],
  },
  {
    key: "order_restaurant", title: "Orders — restaurant",
    description: "The live kitchen board, as alerts the restaurant must act on.",
    events: [
      e("kitchen.new_order", "New order", "Nouvelle commande {{order}}", "warning", R, ["inapp", "push"], true),
      e("kitchen.accept_reminder", "Accept reminder", "Commande {{order}} en attente d'acceptation", "warning", R, ["inapp", "push"], true),
      e("kitchen.order_accepted", "Order accepted", "Commande {{order}} acceptée", "success", R, inapp),
      e("kitchen.prep_timeout_warning", "Prep timeout warning", "Commande {{order}} bientôt en retard", "warning", R, ["inapp", "push"]),
      e("kitchen.ready_for_handover", "Ready for handover", "Commande {{order}} prête pour le livreur", "info", R, ["inapp", "push"]),
      e("kitchen.rider_arrived", "Rider arrived", "{{rider}} est au comptoir pour {{order}}", "info", R, ["inapp", "push"]),
      e("kitchen.handover_code", "Handover code", "Code de remise au livreur : {{code}}", "info", R, inapp, true),
      e("kitchen.auto_cancel_timeout", "Auto-cancelled (timeout)", "Commande {{order}} annulée (délai dépassé)", "warning", R, email_inapp),
      e("kitchen.order_cancelled_customer", "Customer cancelled", "Le client a annulé la commande {{order}}", "info", R, ["inapp", "push"]),
    ],
  },
  {
    key: "dispatch_rider", title: "Dispatch — rider",
    description: "Job offers and each custody step for the deliveryman.",
    events: [
      e("dispatch.offer", "Job offer", "Nouvelle course — {{earnings}}", "info", D, ["inapp", "push"], true),
      e("dispatch.offer_expired", "Offer expired", "L'offre de course a expiré", "info", D, inapp),
      e("dispatch.assigned", "Job assigned", "Course assignée : {{order}}", "success", D, ["inapp", "push"]),
      e("dispatch.reassigned", "Reassigned", "Votre course a été réassignée", "warning", D, ["inapp", "push"]),
      e("dispatch.go_to_kitchen", "Head to kitchen", "Rendez-vous chez {{restaurant}}", "info", D, ["inapp", "push"]),
      e("dispatch.pickup_confirmed", "Pickup confirmed", "Retrait confirmé pour {{order}}", "info", D, inapp),
      e("dispatch.go_to_customer", "Head to customer", "En route vers {{customer}}", "info", D, ["inapp", "push"]),
      e("dispatch.delivered", "Delivered", "Livraison confirmée — {{earnings}}", "success", D, ["inapp", "push"]),
      e("dispatch.delivery_failed", "Delivery failed", "Échec de livraison enregistré", "warning", D, email_inapp),
      e("dispatch.cash_collected", "Cash collected", "Espèces encaissées : {{amount}}", "info", D, inapp),
      e("dispatch.cash_handin_due", "Cash hand-in due", "Espèces à remettre au hub : {{amount}}", "warning", D, ["inapp", "push"], true),
      e("dispatch.signal_lost", "Signal lost", "Signal GPS perdu — reconnectez-vous", "warning", D, ["inapp", "push"]),
    ],
  },
  {
    key: "payments", title: "Payments & wallet",
    description: "Customer payments, mobile money, cash on delivery and wallet.",
    events: [
      e("payment.pending", "Payment pending", "Paiement en cours de traitement", "info", C, inapp),
      e("payment.successful", "Payment successful", "Paiement reçu — {{amount}}", "success", C, email_inapp),
      e("payment.failed", "Payment failed", "Votre paiement a échoué", "warning", C, email_inapp_sms, true),
      e("payment.retry", "Payment retry", "Nous réessayons votre paiement", "info", C, email_inapp),
      e("payment.cod_confirmed", "Cash on delivery confirmed", "Paiement à la livraison confirmé", "info", C, ["inapp", "push"]),
      e("payment.refund_processed", "Refund processed", "Votre remboursement de {{amount}} est traité", "success", C, email_inapp, true),
      e("wallet.topup", "Wallet top-up", "Portefeuille rechargé de {{amount}}", "success", C, email_inapp),
      e("wallet.debit", "Wallet debit", "{{amount}} débité de votre portefeuille", "info", C, inapp),
      e("payment.partial", "Partial payment", "Paiement partiel enregistré", "info", C, email_inapp),
    ],
  },
  {
    key: "payouts", title: "Payouts & earnings",
    description: "What restaurants and riders earn, and when it is paid out.",
    events: [
      e("payout.earnings_summary", "Earnings summary", "Votre relevé de gains {{period}}", "info", ["restaurant", "rider"], email_inapp),
      e("payout.initiated", "Payout initiated", "Versement de {{amount}} initié", "info", ["restaurant", "rider"], email_inapp),
      e("payout.paid", "Payout paid", "Versement de {{amount}} effectué", "success", ["restaurant", "rider"], email_inapp),
      e("payout.failed", "Payout failed", "Le versement a échoué", "warning", ["restaurant", "rider"], email_inapp_sms, true),
      e("payout.statement_ready", "Statement ready", "Votre relevé {{period}} est disponible", "info", R, email_inapp),
      e("payout.cash_remittance_recorded", "Cash remittance recorded", "Remise d'espèces de {{amount}} enregistrée", "success", D, email_inapp),
      e("payout.commission_invoice", "Commission invoice", "Facture de service {{number}} disponible", "info", R, email_inapp),
    ],
  },
  {
    key: "promotions", title: "Promotions & loyalty",
    description: "Coupons, cashback, loyalty points and referrals.",
    events: [
      e("promo.coupon_granted", "Coupon granted", "Un coupon vous attend : {{code}}", "success", C, email_inapp_push),
      e("promo.coupon_expiring", "Coupon expiring", "Votre coupon expire {{date}}", "warning", C, ["inapp", "push"]),
      e("promo.cashback_earned", "Cashback earned", "Cashback de {{amount}} crédité", "success", C, ["inapp", "push"]),
      e("promo.loyalty_earned", "Loyalty points earned", "Vous avez gagné {{points}} points", "info", C, inapp),
      e("promo.loyalty_redeemed", "Loyalty redeemed", "{{points}} points échangés", "success", C, inapp),
      e("promo.referral_invite", "Referral invite", "Parrainez un ami, gagnez {{amount}}", "info", C, email_inapp),
      e("promo.referral_reward", "Referral reward", "Votre récompense de parrainage est créditée", "success", C, email_inapp_push),
      e("promo.campaign_live", "Campaign live", "Nouvelle campagne : {{campaign}}", "info", ["customer", "restaurant"], email_inapp),
    ],
  },
  {
    key: "reviews", title: "Reviews & ratings",
    description: "Ratings between customers, restaurants and riders.",
    events: [
      e("review.request", "Review request", "Notez votre commande {{order}}", "info", C, ["inapp", "push"]),
      e("review.received", "Review received", "Nouvel avis sur {{item}}", "info", R, email_inapp),
      e("review.reply", "Reply to review", "{{restaurant}} a répondu à votre avis", "info", C, inapp),
      e("review.low_rating_alert", "Low rating alert", "Avis faible reçu — à examiner", "warning", ["restaurant", "admin"], email_inapp),
      e("review.rider_rated", "Rider rated", "Votre livraison a été notée", "info", D, inapp),
    ],
  },
  {
    key: "rider_onboarding", title: "Rider onboarding",
    description: "Self-registration, document checks and approval for deliverymen.",
    events: [
      e("rider.application_received", "Application received", "Nous avons reçu votre candidature livreur", "info", D, email_inapp),
      e("rider.documents_requested", "Documents requested", "Documents requis pour votre dossier", "warning", D, email_inapp),
      e("rider.under_review", "Under review", "Votre candidature est en cours d'examen", "info", D, inapp),
      e("rider.approved", "Approved", "Félicitations — vous êtes livreur Tunakula", "success", D, email_inapp_push),
      e("rider.rejected", "Rejected", "Mise à jour sur votre candidature", "warning", D, email_inapp),
      e("rider.suspended", "Suspended", "Votre compte livreur est suspendu", "critical", D, email_inapp_sms, true),
      e("rider.reinstated", "Reinstated", "Votre compte livreur est réactivé", "success", D, email_inapp),
      e("rider.document_expiring", "Document expiring", "Votre {{document}} expire {{date}}", "warning", D, email_inapp),
    ],
  },
  {
    key: "merchant_onboarding", title: "Restaurant onboarding & store",
    description: "Joining, going live, and managing the storefront.",
    events: [
      e("merchant.application_received", "Application received", "Candidature reçue pour {{restaurant}}", "info", R, email_inapp),
      e("merchant.approved", "Approved", "{{restaurant}} est approuvé", "success", R, email_inapp),
      e("merchant.rejected", "Rejected", "Mise à jour sur la candidature de {{restaurant}}", "warning", R, email_inapp),
      e("merchant.menu_live", "Menu live", "Votre menu est en ligne", "success", R, email_inapp),
      e("merchant.store_paused", "Store paused", "{{restaurant}} ne prend plus de commandes", "warning", R, ["inapp", "push"]),
      e("merchant.store_resumed", "Store resumed", "{{restaurant}} prend à nouveau des commandes", "success", R, ["inapp", "push"]),
      e("merchant.hours_updated", "Hours updated", "Vos horaires ont été mis à jour", "info", R, inapp),
      e("merchant.plan_changed", "Plan changed", "Votre forfait a changé", "info", R, email_inapp),
      e("merchant.commission_updated", "Commission updated", "Vos conditions de service ont changé", "warning", R, email_inapp, true),
    ],
  },
  {
    key: "scheduling", title: "Scheduled & subscription orders",
    description: "Orders placed for later and repeat subscriptions.",
    events: [
      e("schedule.confirmed", "Scheduled order confirmed", "Commande programmée pour {{datetime}}", "success", C, email_inapp),
      e("schedule.reminder", "Scheduled reminder", "Votre commande part bientôt", "info", C, ["inapp", "push"]),
      e("subscription.created", "Subscription created", "Votre abonnement est actif", "success", C, email_inapp),
      e("subscription.upcoming", "Upcoming subscription order", "Votre commande d'abonnement arrive {{date}}", "info", C, ["inapp", "push"]),
      e("subscription.paused", "Subscription paused", "Votre abonnement est en pause", "info", C, email_inapp),
      e("subscription.payment_due", "Subscription payment due", "Paiement d'abonnement à venir", "warning", C, email_inapp),
    ],
  },
  {
    key: "support", title: "Support & disputes",
    description: "Help tickets, refund requests and disputes.",
    events: [
      e("support.ticket_created", "Ticket created", "Ticket {{number}} créé", "info", ["customer", "restaurant", "rider"], email_inapp),
      e("support.ticket_updated", "Ticket updated", "Mise à jour du ticket {{number}}", "info", ["customer", "restaurant", "rider"], email_inapp),
      e("support.ticket_resolved", "Ticket resolved", "Ticket {{number}} résolu", "success", ["customer", "restaurant", "rider"], email_inapp),
      e("refund.requested", "Refund requested", "Demande de remboursement reçue", "info", C, email_inapp),
      e("refund.approved", "Refund approved", "Votre remboursement est approuvé", "success", C, email_inapp, true),
      e("refund.declined", "Refund declined", "Décision sur votre remboursement", "warning", C, email_inapp),
      e("dispute.opened", "Dispute opened", "Litige ouvert sur la commande {{order}}", "warning", ["customer", "restaurant", "admin"], email_inapp),
    ],
  },
  {
    key: "compliance", title: "Compliance, safety & privacy",
    description: "Consent, data rights, food safety and KYC.",
    events: [
      e("privacy.consent_request", "Consent request", "Nous avons besoin de votre consentement", "info", ["customer", "restaurant", "rider"], email_inapp, true),
      e("privacy.consent_updated", "Consent updated", "Vos préférences de consentement sont à jour", "info", ["customer", "restaurant", "rider"], email_inapp),
      e("privacy.data_export_ready", "Data export ready", "Votre export de données est prêt", "success", ["customer", "restaurant", "rider"], email_inapp),
      e("privacy.account_deletion_requested", "Account deletion requested", "Suppression de compte demandée", "warning", ["customer", "restaurant", "rider"], email_inapp, true),
      e("privacy.account_deletion_completed", "Account deletion completed", "Votre compte a été supprimé", "info", ["customer", "restaurant", "rider"], email_inapp, true),
      e("safety.allergen_notice", "Allergen notice", "Information allergènes sur votre commande", "warning", C, ["inapp", "push"], true),
      e("safety.food_incident", "Food safety incident", "Incident de sécurité alimentaire signalé", "critical", ["restaurant", "admin"], email_inapp_sms, true),
      e("compliance.kyc_required", "KYC required", "Vérification d'identité requise", "warning", ["restaurant", "rider"], email_inapp, true),
    ],
  },
  {
    key: "platform", title: "Platform & operations",
    description: "Maintenance, markets, surge and operational alerts for the console.",
    events: [
      e("system.maintenance_scheduled", "Scheduled maintenance", "Maintenance planifiée le {{date}}", "info", ["restaurant", "rider", "admin"], email_inapp),
      e("system.maintenance_emergency", "Emergency maintenance", "Maintenance d'urgence en cours", "warning", ["restaurant", "rider", "admin"], email_inapp_sms, true),
      e("system.outage", "Service outage", "Interruption de service", "critical", ["customer", "restaurant", "rider", "admin"], full_critical, true),
      e("system.service_restored", "Service restored", "Service rétabli", "success", ["restaurant", "rider", "admin"], email_inapp),
      e("ops.market_go_live", "Market go-live", "{{market}} est en ligne", "success", A, email_inapp),
      e("ops.country_profile_published", "Country profile published", "Profil pays {{market}} publié (v{{version}})", "info", A, email_inapp),
      e("ops.surge_active", "Surge pricing active", "Tarification dynamique active sur {{zone}}", "warning", ["restaurant", "rider", "admin"], ["inapp", "push"]),
      e("ops.zone_closed", "Zone closed", "La zone {{zone}} est fermée aux commandes", "warning", ["restaurant", "rider", "admin"], ["inapp", "push"]),
      e("ops.kpi_alert", "KPI alert", "Alerte indicateur : {{item}}", "warning", A, email_inapp_push),
      e("audit.investigation_opened", "Investigation opened", "Enquête ouverte : {{item}}", "warning", A, email_inapp, true),
    ],
  },
] as const;

export interface CommsSummary {
  readonly events: number;
  readonly categories: number;
  readonly mandatory: number;
  readonly channels: number;
  readonly channelCoverage: Record<CommsChannel, number>;
  readonly byAudience: Record<CommsAudience, number>;
}

/** Headline counts the console shows and the backend can assert against in tests. */
export function commsSummary(catalogue: readonly CommsCategory[] = COMMS_CATALOGUE): CommsSummary {
  const channelCoverage = Object.fromEntries(COMMS_CHANNELS.map((c) => [c, 0])) as Record<CommsChannel, number>;
  const byAudience = Object.fromEntries(COMMS_AUDIENCES.map((a) => [a, 0])) as Record<CommsAudience, number>;
  let events = 0, mandatory = 0;
  for (const cat of catalogue) {
    for (const ev of cat.events) {
      events += 1;
      if (ev.mandatory) mandatory += 1;
      for (const ch of ev.channels) channelCoverage[ch] += 1;
      for (const au of ev.audience) byAudience[au] += 1;
    }
  }
  return { events, categories: catalogue.length, mandatory, channels: COMMS_CHANNELS.length, channelCoverage, byAudience };
}

/** Flat lookup of every event by key (unique across the catalogue). */
export const COMMS_EVENTS: ReadonlyMap<string, CommsEvent> = new Map(
  COMMS_CATALOGUE.flatMap((c) => c.events.map((ev) => [ev.key, ev] as const)),
);
