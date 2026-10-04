/**
 * Structured logging with PII redaction at source (PRD §28.3, §23.4 PII
 * minimisation). Every line is one JSON object carrying the trace id, so
 * support tools can jump from a ticket to the trace. Personal data is removed
 * before a line leaves the process — by key and by value pattern — so a
 * careless log call cannot leak a phone number, email, code or card.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  readonly traceId?: string;
  readonly spanId?: string;
  /** Active country (X-Country) — logs are filtered and retained per market. */
  readonly country?: string;
}

export interface LogSink {
  write(line: string): void;
}

export const REDACTED = "[REDACTED]";

/**
 * Keys whose values are always personal or secret, whatever they contain.
 * Matched on the normalised key (lower case, no "_" or "-"), by suffix, so
 * `dropLocation`, `customer_phone` and `payoutAccountNumber` are all caught.
 */
const SENSITIVE_SUFFIXES = [
  "phone", "phonee164", "msisdn", "mobile", "email",
  "displayname", "fullname", "firstname", "lastname", "recipientname",
  "address", "addressline1", "addressline2", "location", "landmark", "voicenote", "coordinates",
  "password", "passcode", "secret", "token", "apikey", "otp", "otpcode", "recipientcode", "codehash",
  "cardnumber", "cvv", "iban", "accountnumber", "signature", "authorization", "cookie",
  "deviceid", "ipaddress",
];
const SENSITIVE_EXACT = new Set(["pan", "pin", "lat", "lng", "latitude", "longitude", "ip", "recipient", "name"]);

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, "");
  return SENSITIVE_EXACT.has(k) || SENSITIVE_SUFFIXES.some((s) => k.endsWith(s));
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+\d[\d\s-]{7,16}\d/g;
const DIGIT_RUN = /\b\d(?:[ -]?\d){12,18}\b/g;

/** True for digit runs that pass the Luhn check — card numbers. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactString(value: string): string {
  return value
    .replace(EMAIL, "[EMAIL]")
    .replace(DIGIT_RUN, (run) => (luhn(run.replace(/[ -]/g, "")) ? "[CARD]" : run))
    .replace(PHONE, "[PHONE]");
}

/** Deep copy with personal data removed. Pseudonymous ids pass through unchanged. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}

export interface Logger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>, ctx?: LogContext): void;
  debug(message: string, fields?: Record<string, unknown>, ctx?: LogContext): void;
  info(message: string, fields?: Record<string, unknown>, ctx?: LogContext): void;
  warn(message: string, fields?: Record<string, unknown>, ctx?: LogContext): void;
  error(message: string, fields?: Record<string, unknown>, ctx?: LogContext): void;
  child(ctx: LogContext): Logger;
}

export function createLogger(options: { service: string; sink?: LogSink; level?: LogLevel; now?: () => Date; context?: LogContext }): Logger {
  const sink = options.sink ?? { write: (line) => process.stdout.write(`${line}\n`) };
  const min = LEVELS[options.level ?? "info"];
  const now = options.now ?? (() => new Date());
  const base = options.context ?? {};

  const log = (level: LogLevel, message: string, fields: Record<string, unknown> = {}, ctx: LogContext = {}) => {
    if (LEVELS[level] < min) return;
    const c = { ...base, ...ctx };
    sink.write(
      JSON.stringify({
        ts: now().toISOString(),
        level,
        service: options.service,
        msg: redactString(message),
        ...(c.traceId ? { traceId: c.traceId } : {}),
        ...(c.spanId ? { spanId: c.spanId } : {}),
        ...(c.country ? { country: c.country } : {}),
        ...(redact(fields) as Record<string, unknown>),
      }),
    );
  };
  return {
    log,
    debug: (m, f, c) => log("debug", m, f, c),
    info: (m, f, c) => log("info", m, f, c),
    warn: (m, f, c) => log("warn", m, f, c),
    error: (m, f, c) => log("error", m, f, c),
    child: (ctx) => createLogger({ ...options, context: { ...base, ...ctx } }),
  };
}
