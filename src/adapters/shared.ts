import { type RateLimitResult } from "../types.js";

/** Reads a header case-insensitively; returns the first value if it is a list. */
export type HeaderLookup = (name: string) => string | undefined;

/**
 * Best-effort client identifier from proxy headers. Checks, in order,
 * `x-forwarded-for` (first hop), `cf-connecting-ip`, `x-real-ip`, then the
 * supplied fallback. Only trust these behind a proxy you control.
 */
export function clientIp(lookup: HeaderLookup, fallback?: string): string {
  const forwarded = lookup("x-forwarded-for");
  if (forwarded !== undefined) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  const cf = lookup("cf-connecting-ip")?.trim();
  if (cf !== undefined && cf !== "") return cf;
  const real = lookup("x-real-ip")?.trim();
  if (real !== undefined && real !== "") return real;
  return fallback ?? "unknown";
}

/** Standard headers (draft-ietf-httpapi-ratelimit-headers) plus `Retry-After` when denied. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetMs / 1000)),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
  }
  return headers;
}

export const TOO_MANY_REQUESTS_BODY = JSON.stringify({ error: "Too Many Requests" });
