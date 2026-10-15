/**
 * Minimal SMTP email sender — zero dependencies, in the same raw-protocol spirit as the Twilio adapter
 * (which speaks HTTP directly). It connects, opportunistically upgrades to TLS via STARTTLS when the
 * server offers it (or uses implicit TLS on 465), authenticates with AUTH LOGIN when credentials are
 * given, and sends one message. Subject and body are UTF-8 safe (encoded-word subject, base64 body),
 * so emoji and accents survive. Used by the comms engine's `email` channel; without SMTP config that
 * channel just logs, like SMS without Twilio.
 */
import net from "node:net";
import tls from "node:tls";

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS from the first byte (typically port 465). Otherwise plain + opportunistic STARTTLS (587/25). */
  readonly secure?: boolean;
  readonly user?: string;
  readonly pass?: string;
  /** Envelope + header From, e.g. "Tunakula <no-reply@tunakula.com>" or "no-reply@tunakula.com". */
  readonly from: string;
  readonly timeoutMs?: number;
}
export interface EmailMessage { readonly to: string; readonly subject: string; readonly text: string }
export interface EmailResult { readonly status: "sent" | "failed"; readonly ref?: string; readonly failure?: string }

const addrOf = (from: string): string => from.match(/<([^>]+)>/)?.[1] ?? from.trim();
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const encodedWord = (s: string) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${b64(s)}?=` : s);
const chunk76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n");

/** Reads SMTP replies off a socket, handling multi-line replies ("250-foo" … "250 bar") and chunk boundaries. */
function reader(sock: net.Socket) {
  let buf = "";
  let acc: string[] = [];
  const waiters: ((r: { code: number; text: string }) => void)[] = [];
  const ready: { code: number; text: string }[] = [];
  const pump = () => { while (waiters.length && ready.length) waiters.shift()!(ready.shift()!); };
  sock.on("data", (d) => {
    buf += d.toString("utf8");
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      acc.push(line);
      if (/^\d{3} /.test(line)) { ready.push({ code: Number(line.slice(0, 3)), text: acc.join("\n") }); acc = []; pump(); }
    }
  });
  return () => new Promise<{ code: number; text: string }>((res) => { waiters.push(res); pump(); });
}

export function smtpSender(cfg: SmtpConfig) {
  return { send: (m: EmailMessage) => sendMail(cfg, m) };
}

/** Send one email. Resolves to a delivery result; never throws. */
export async function sendMail(cfg: SmtpConfig, msg: EmailMessage): Promise<EmailResult> {
  const timeoutMs = cfg.timeoutMs ?? 15_000;
  let sock: net.Socket;
  try {
    sock = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });
    await new Promise<void>((res, rej) => { sock.once(cfg.secure ? "secureConnect" : "connect", res); sock.once("error", rej); });
  } catch (e) { return { status: "failed", failure: `connect: ${(e as Error).message}` }; }

  sock.setTimeout(timeoutMs);
  const fail = { fired: false };
  const guard = new Promise<EmailResult>((res) => { sock.once("timeout", () => { fail.fired = true; sock.destroy(); res({ status: "failed", failure: "timeout" }); }); sock.once("error", (e) => { if (!fail.fired) { fail.fired = true; res({ status: "failed", failure: e.message }); } }); });

  const run = (async (): Promise<EmailResult> => {
    let read = reader(sock);
    const say = async (line: string, expect = 2): Promise<{ code: number; text: string }> => {
      sock.write(line + "\r\n");
      const r = await read();
      if (Math.floor(r.code / 100) !== expect) throw new Error(`${line.split(" ")[0]} → ${r.code} ${r.text.replace(/\n/g, " ")}`);
      return r;
    };
    try {
      await read(); // server greeting (220)
      let ehlo = await say(`EHLO ${hostnameFor(cfg)}`);
      // Opportunistic STARTTLS when offered and we are not already on TLS.
      if (!cfg.secure && /STARTTLS/i.test(ehlo.text)) {
        await say("STARTTLS");
        const upgraded = tls.connect({ socket: sock, servername: cfg.host });
        await new Promise<void>((res, rej) => { upgraded.once("secureConnect", res); upgraded.once("error", rej); });
        sock = upgraded;
        read = reader(sock);
        ehlo = await say(`EHLO ${hostnameFor(cfg)}`);
      }
      if (cfg.user && cfg.pass) {
        await say("AUTH LOGIN", 3);
        await say(b64(cfg.user), 3);
        await say(b64(cfg.pass));
      }
      await say(`MAIL FROM:<${addrOf(cfg.from)}>`);
      await say(`RCPT TO:<${msg.to.trim()}>`);
      await say("DATA", 3);
      const headers = [
        `From: ${cfg.from}`,
        `To: ${msg.to.trim()}`,
        `Subject: ${encodedWord(msg.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
      ].join("\r\n");
      const body = chunk76(b64(msg.text));
      sock.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
      const done = await read();
      if (Math.floor(done.code / 100) !== 2) throw new Error(`DATA → ${done.code} ${done.text.replace(/\n/g, " ")}`);
      sock.write("QUIT\r\n");
      sock.end();
      return { status: "sent", ref: done.text.split("\n").pop()?.slice(4).trim() || "accepted" };
    } catch (e) {
      try { sock.end(); } catch { /* already closed */ }
      return { status: "failed", failure: (e as Error).message };
    }
  })();

  return Promise.race([run, guard]);
}

const hostnameFor = (cfg: SmtpConfig) => (addrOf(cfg.from).split("@")[1] ?? "tunakula.com");
