/** Compact signed session tokens (HMAC-SHA256). The secret comes from Secret Manager in production. */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface TokenClaims {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
}

export class TokenService {
  readonly #secret: Buffer;
  readonly #ttlSeconds: number;
  readonly #now: () => Date;

  constructor(secret: string, options: { ttlSeconds?: number; now?: () => Date } = {}) {
    if (secret.length < 32) throw new Error("Token secret must be at least 32 characters");
    this.#secret = Buffer.from(secret);
    this.#ttlSeconds = options.ttlSeconds ?? 30 * 24 * 3600;
    this.#now = options.now ?? (() => new Date());
  }

  issue(userId: string): { token: string; expiresAt: Date } {
    const iat = Math.floor(this.#now().getTime() / 1000);
    const claims: TokenClaims = { sub: userId, iat, exp: iat + this.#ttlSeconds };
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return { token: `${body}.${this.#sign(body)}`, expiresAt: new Date(claims.exp * 1000) };
  }

  verify(token: string): TokenClaims | undefined {
    const [body, sig] = token.split(".");
    if (!body || !sig) return undefined;
    const expected = Buffer.from(this.#sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    try {
      const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenClaims;
      return claims.exp * 1000 > this.#now().getTime() && typeof claims.sub === "string" ? claims : undefined;
    } catch {
      return undefined;
    }
  }

  #sign(body: string): string {
    return createHmac("sha256", this.#secret).update(body).digest("base64url");
  }
}
