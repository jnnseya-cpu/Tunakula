/**
 * Composition glue that puts a real MessagingChannel behind the two seams that need it:
 *  - the dispatch engine's ChannelSender (SMS and WhatsApp deliveries), and
 *  - sign-in's OtpSender (the one-time code),
 * so one provider adapter (e.g. Twilio) serves both. Channels with no adapter yet — email, push,
 * and the in-app feed (delivered via the inbox) — are recorded as "logged".
 */
import type { OtpSender } from "./auth.ts";
import type { ChannelResult, ChannelSender } from "./comms.ts";
import type { MessagingChannel } from "../modules/messaging/messaging.ts";
import type { EmailMessage, EmailResult } from "../modules/messaging/smtp.ts";

/** Bridges a MessagingChannel into the dispatch engine. SMS/WhatsApp are sent; the rest are logged. */
export function messagingSender(messaging: MessagingChannel): ChannelSender {
  return {
    async send(message): Promise<ChannelResult> {
      if (message.channel !== "sms" && message.channel !== "whatsapp") return { status: "logged" };
      const phone = message.to.phone;
      if (!phone) return { status: "failed", failure: "no phone number on file" };
      const r = await messaging.send({ to: phone, kind: message.channel === "sms" ? "SMS" : "WHATSAPP", text: message.subject });
      if (r.status === "sent") return { status: "sent", ref: r.ref };
      // unavailable / unknown / failed all land as a failed delivery row, with the reason recorded.
      return { status: "failed", failure: `${r.status}: ${r.failure}` };
    },
  };
}

/** The dispatch engine's `email` channel adapter: sends over SMTP. No address on file → logged, not failed. */
export function emailSender(smtp: { send(m: EmailMessage): Promise<EmailResult> }): ChannelSender {
  return {
    async send(message): Promise<ChannelResult> {
      if (message.channel !== "email") return { status: "logged" };
      const to = message.to.email;
      if (!to) return { status: "logged" }; // no email on file — nothing to send to
      const subject = message.subject.slice(0, 150);
      const r = await smtp.send({ to, subject, text: message.subject });
      return r.status === "sent" ? { status: "sent", ...(r.ref ? { ref: r.ref } : {}) } : { status: "failed", failure: r.failure ?? "email send failed" };
    },
  };
}

const CODE_TEXT: Record<string, (code: string) => string> = {
  fr: (code) => `Votre code Tunakula : ${code}. Il expire dans 5 minutes.`,
  en: (code) => `Your Tunakula code is ${code}. It expires in 5 minutes.`,
};

/** Sends sign-in codes through the messaging adapter. A non-send outcome throws so sign-in reports it. */
export function otpViaMessaging(messaging: MessagingChannel): OtpSender {
  return {
    async send(phoneE164, code, channel, locale) {
      const text = (CODE_TEXT[locale] ?? CODE_TEXT.fr)!(code);
      const r = await messaging.send({ to: phoneE164, kind: channel, text, locale });
      if (r.status !== "sent") throw new Error(`Could not send the sign-in code (${r.status}: ${r.failure})`);
    },
  };
}
