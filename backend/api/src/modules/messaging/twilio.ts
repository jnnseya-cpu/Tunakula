/**
 * Twilio messaging adapter: one provider for both SMS and WhatsApp (Twilio's WhatsApp Business API),
 * which suits a DRC rollout where WhatsApp carries most traffic. It speaks the Messages REST API and
 * maps every outcome onto the MessagingChannel contract.
 *
 *   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 *   Basic auth {SID}:{AUTH_TOKEN}, form-encoded To / From / Body. WhatsApp uses the `whatsapp:` prefix.
 */
import { fetchSend, NeverSentError, OutcomeUnknownError, type HttpSend, type MessagingChannel, type MessagingResult, type OutboundMessage } from "./messaging.ts";

export interface TwilioConfig {
  readonly accountSid: string;
  readonly authToken: string;
  /** E.164 sender for SMS, e.g. +1XXXXXXXXXX or a Messaging Service SID. */
  readonly smsFrom?: string;
  /** WhatsApp sender (E.164 of your approved WhatsApp number), e.g. +14155238886. */
  readonly whatsappFrom?: string;
  /** Swap for tests; defaults to a real fetch transport. */
  readonly send?: HttpSend;
}

const parseSid = (body: string): string => {
  try { return (JSON.parse(body) as { sid?: string }).sid ?? ""; } catch { return ""; }
};
const parseError = (body: string): string => {
  try {
    const j = JSON.parse(body) as { message?: string; code?: number };
    return j.message ? `${j.message}${j.code ? ` (code ${j.code})` : ""}` : body.slice(0, 200);
  } catch { return body.slice(0, 200); }
};

export function twilioMessaging(config: TwilioConfig): MessagingChannel {
  const send = config.send ?? fetchSend();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  return {
    async send(message: OutboundMessage): Promise<MessagingResult> {
      const from = message.kind === "WHATSAPP" ? config.whatsappFrom : config.smsFrom;
      if (!from) return { status: "failed", failure: `No ${message.kind} sender number configured` };
      const to = message.kind === "WHATSAPP" ? `whatsapp:${message.to}` : message.to;
      const fromAddr = message.kind === "WHATSAPP" ? `whatsapp:${from}` : from;
      const body = new URLSearchParams({ To: to, From: fromAddr, Body: message.text }).toString();

      let reply;
      try {
        reply = await send({ method: "POST", url, headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
      } catch (error) {
        if (error instanceof NeverSentError) return { status: "unavailable", failure: error.message };
        if (error instanceof OutcomeUnknownError) return { status: "unknown", failure: error.message };
        return { status: "unknown", failure: (error as Error).message };
      }

      if (reply.status >= 200 && reply.status < 300) return { status: "sent", ref: parseSid(reply.body) };
      // 4xx (except 429) is a definite rejection; 429 and 5xx may or may not have been queued.
      if (reply.status >= 400 && reply.status < 500 && reply.status !== 429) return { status: "failed", failure: parseError(reply.body) };
      return { status: "unknown", failure: `Twilio HTTP ${reply.status}: ${parseError(reply.body)}` };
    },
  };
}
