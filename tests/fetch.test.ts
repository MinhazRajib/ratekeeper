import { describe, expect, it, vi } from "vitest";
import { FixedWindow, MemoryStore, RateLimiter, type Store, fetchRateLimit } from "../src/index.js";
import { fakeClock } from "./helpers.js";

const limiterOf = (limit: number) => {
  const clock = fakeClock(250);
  return new RateLimiter({
    algorithm: new FixedWindow({ limit, windowMs: 1000 }),
    store: new MemoryStore({ clock }),
    clock,
  });
};

const req = (headers: Record<string, string> = {}) =>
  new Request("https://example.com/api", { headers });

describe("fetchRateLimit", () => {
  it("passes the request and extra args through and adds headers when allowed", async () => {
    const handler = vi.fn((_r: Request, env: { name: string }) => new Response(`hi ${env.name}`));
    const wrapped = fetchRateLimit(limiterOf(2))(handler);
    const res = await wrapped(req({ "x-forwarded-for": "1.1.1.1" }), { name: "edge" });
    expect(await res.text()).toBe("hi edge");
    expect(res.status).toBe(200);
    expect(res.headers.get("RateLimit-Limit")).toBe("2");
    expect(res.headers.get("RateLimit-Remaining")).toBe("1");
    expect(res.headers.get("RateLimit-Reset")).toBe("1");
    expect(res.headers.has("Retry-After")).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("returns 429 with Retry-After without calling the handler when denied", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const wrapped = fetchRateLimit(limiterOf(1))(handler);
    await wrapped(req({ "cf-connecting-ip": "2.2.2.2" }));
    const res = await wrapped(req({ "cf-connecting-ip": "2.2.2.2" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(res.headers.get("RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "Too Many Requests" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("copies headers onto immutable responses (e.g. redirects)", async () => {
    const wrapped = fetchRateLimit(limiterOf(1))(() =>
      Response.redirect("https://example.com/x", 302),
    );
    const res = await wrapped(req());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/x");
    expect(res.headers.get("RateLimit-Limit")).toBe("1");
  });

  it("supports keyFn, cost, custom 429 and disabling headers", async () => {
    const limiter = limiterOf(2);
    const wrapped = fetchRateLimit(limiter, {
      keyFn: (r) => r.headers.get("authorization") ?? "anon",
      cost: (r) => (r.method === "POST" ? 2 : 1),
      onLimited: (_r, result) => new Response(`retry in ${result.retryAfterMs}`, { status: 503 }),
      headers: false,
    })(() => new Response("ok"));

    const first = await wrapped(
      new Request("https://x/", { method: "POST", headers: { authorization: "t" } }),
    );
    expect(first.status).toBe(200);
    expect(first.headers.has("RateLimit-Limit")).toBe(false);

    const second = await wrapped(req({ authorization: "t" }));
    expect(second.status).toBe(503);
    expect(await second.text()).toBe("retry in 750");
    expect(second.headers.get("Retry-After")).toBe("1");
    await expect(limiter.peek("anon")).resolves.toMatchObject({ remaining: 2 });
  });

  it("uses a numeric cost", async () => {
    const wrapped = fetchRateLimit(limiterOf(2), { cost: 2 })(() => new Response("ok"));
    expect((await wrapped(req())).status).toBe(200);
    expect((await wrapped(req())).status).toBe(429);
  });

  it("fails open by default when the store throws, or rethrows", async () => {
    const broken: Store = {
      get: () => Promise.reject(new Error("down")),
      update: () => Promise.reject(new Error("down")),
      delete: () => Promise.resolve(),
    };
    const limiter = new RateLimiter({
      algorithm: new FixedWindow({ limit: 1, windowMs: 1000 }),
      store: broken,
    });
    const handler = () => new Response("ok");
    expect((await fetchRateLimit(limiter)(handler)(req())).status).toBe(200);
    await expect(fetchRateLimit(limiter, { failOpen: false })(handler)(req())).rejects.toThrow(
      "down",
    );
  });
});
