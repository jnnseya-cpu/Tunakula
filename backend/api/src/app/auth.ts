/** Phone OTP sign-in (§9.5, IDN-001): one global account across countries. */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/db.ts";
import { createUser, userByPhone } from "../persistence/identity.ts";
import { badRequest, ApiError } from "./errors.ts";
import type { TokenService } from "./tokens.ts";

/** Port to the MessagingChannel adapter (§7.3). */
export interface OtpSender {
  send(phoneE164: string, code: string, channel: "SMS" | "WHATSAPP", locale: string): Promise<void>;
}

/** Development sender: keeps the last code per phone in memory. Never used in production. */
export class DevOtpOutbox implements OtpSender {
  readonly sent = new Map<string, string>();
  async send(phone: string, code: string): Promise<void> {
    this.sent.set(phone, code);
  }
}

const PHONE = /^\+[1-9]\d{6,14}$/;
const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 5;

const hash = (phone: string, code: string) => createHash("sha256").update(`${phone}:${code}`).digest("hex");

export class AuthService {
  private readonly db: Db;
  private readonly otp: OtpSender;
  private readonly tokens: TokenService;
  private readonly now: () => Date;

  constructor(db: Db, otp: OtpSender, tokens: TokenService, now: () => Date = () => new Date()) {
    this.db = db;
    this.otp = otp;
    this.tokens = tokens;
    this.now = now;
  }

  async requestCode(phone: string, channel: "SMS" | "WHATSAPP" = "SMS", locale = "fr"): Promise<{ expiresAt: Date }> {
    if (!PHONE.test(phone)) throw badRequest("PHONE_INVALID", "Use the international format, e.g. +243810000000");
    const now = this.now();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(now.getTime() + TTL_MS);
    await this.db.tx({}, async (sql) => {
      const [recent] = await sql.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM identity.otp_challenge WHERE phone_e164 = $1 AND created_at > $2",
        [phone, new Date(now.getTime() - 3600_000)],
      );
      if (Number(recent?.n ?? 0) >= MAX_REQUESTS_PER_HOUR) throw new ApiError(429, "TOO_MANY_CODES", "Too many codes requested; try again later");
      await sql.query(
        "INSERT INTO identity.otp_challenge (phone_e164, code_hash, channel, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)",
        [phone, hash(phone, code), channel, expiresAt, now],
      );
    });
    await this.otp.send(phone, code, channel, locale);
    return { expiresAt };
  }

  async verifyCode(phone: string, code: string, profile: { displayName?: string; homeCountry?: string } = {}): Promise<{ token: string; expiresAt: Date; userId: string; created: boolean }> {
    if (!PHONE.test(phone) || !/^\d{6}$/.test(code)) throw badRequest("CODE_INVALID", "Enter the 6-digit code");
    const now = this.now();
    // A wrong code must still count: the attempt is committed, then the error is raised outside the transaction.
    const result = await this.db.tx({}, async (sql) => {
      const [challenge] = await sql.query<{ id: string; code_hash: string; attempts: number; expires_at: Date }>(
        "SELECT id, code_hash, attempts, expires_at FROM identity.otp_challenge WHERE phone_e164 = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [phone],
      );
      if (!challenge || new Date(challenge.expires_at) <= now) throw badRequest("CODE_EXPIRED", "This code has expired; request a new one");
      if (challenge.attempts >= MAX_ATTEMPTS) throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many attempts; request a new code");
      const ok = timingSafeEqual(Buffer.from(challenge.code_hash), Buffer.from(hash(phone, code)));
      if (!ok) {
        await sql.query("UPDATE identity.otp_challenge SET attempts = attempts + 1 WHERE id = $1", [challenge.id]);
        return undefined;
      }
      await sql.query("UPDATE identity.otp_challenge SET consumed_at = $2 WHERE id = $1", [challenge.id, now]);
      let user = await userByPhone(sql, phone);
      const created = !user;
      if (!user) user = await createUser(sql, { phone, displayName: profile.displayName ?? "Tunakula customer", ...(profile.homeCountry ? { homeCountry: profile.homeCountry } : {}) });
      if (user.status === "DELETED") throw new ApiError(403, "ACCOUNT_DELETED", "This account has been deleted");
      const { token, expiresAt } = this.tokens.issue(user.id);
      return { token, expiresAt, userId: user.id, created };
    });
    if (!result) throw badRequest("CODE_WRONG", "That code is not right");
    return result;
  }
}
