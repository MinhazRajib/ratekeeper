import { describe, expect, it } from "vitest";
import { clientIp, rateLimitHeaders } from "../src/index.js";

describe("clientIp", () => {
  const lookup = (headers: Record<string, string>) => (name: string) => headers[name];

  it("prefers the first x-forwarded-for hop", () => {
    expect(clientIp(lookup({ "x-forwarded-for": " 1.1.1.1 , 2.2.2.2" }), "9.9.9.9")).toBe(
      "1.1.1.1",
    );
  });

  it("falls through cf-connecting-ip, x-real-ip, then the fallback", () => {
    expect(clientIp(lookup({ "cf-connecting-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(lookup({ "x-real-ip": "4.4.4.4" }))).toBe("4.4.4.4");
    expect(clientIp(lookup({ "x-forwarded-for": " , " }), "5.5.5.5")).toBe("5.5.5.5");
    expect(clientIp(lookup({ "cf-connecting-ip": "  " }))).toBe("unknown");
  });
});

describe("rateLimitHeaders", () => {
  it("rounds reset up to whole seconds and omits Retry-After when allowed", () => {
    expect(
      rateLimitHeaders({ allowed: true, limit: 10, remaining: 3, resetMs: 1500, retryAfterMs: 0 }),
    ).toEqual({ "RateLimit-Limit": "10", "RateLimit-Remaining": "3", "RateLimit-Reset": "2" });
  });

  it("adds Retry-After of at least one second when denied", () => {
    expect(
      rateLimitHeaders({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetMs: 200,
        retryAfterMs: 200,
      }),
    ).toMatchObject({ "RateLimit-Reset": "1", "Retry-After": "1" });
    expect(
      rateLimitHeaders({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetMs: 5000,
        retryAfterMs: 2500,
      }),
    ).toMatchObject({ "Retry-After": "3" });
  });
});
