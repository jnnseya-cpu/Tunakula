/** Application errors rendered as RFC 9457 problem+json by the HTTP layer (§25.1). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(status: number, code: string, detail: string, extra: Record<string, unknown> = {}) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code: string, detail: string, extra?: Record<string, unknown>) => new ApiError(400, code, detail, extra);
export const unauthorized = (detail = "Sign in to continue") => new ApiError(401, "UNAUTHENTICATED", detail);
export const forbidden = (detail: string) => new ApiError(403, "FORBIDDEN", detail);
export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (code: string, detail: string, extra?: Record<string, unknown>) => new ApiError(409, code, detail, extra);
export const unprocessable = (code: string, detail: string, extra?: Record<string, unknown>) => new ApiError(422, code, detail, extra);
