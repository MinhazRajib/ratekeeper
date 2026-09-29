import { describe, expect, it } from "vitest";
import { FixedWindow, MemoryStore, RateLimiter, TokenBucket } from "../src/index.js";
import { fakeClock } from "./helpers.js";

describe("RateLimiter", () => {
  it("returns the algorithm result and persists state between checks", async () => {
    const clock = fakeClock(0);
    const limiter = new RateLimiter({
      algorithm: new FixedWindow({ limit: 2, windowMs: 1000 }),
      store: new MemoryStore({ clock }),
      clock,
    });
    expect(limiter.limit).toBe(2);
    await expect(limiter.check("u")).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter.check("u")).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(limiter.check("u")).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 1000,
    });
    clock.advance(1000);
    await expect(limiter.check("u")).resolves.toMatchObject({ allowed: true });
  });

  it("admits exactly `capacity` of 1000 concurrent checks", async () => {
    const limiter = new RateLimiter({
      algorithm: new TokenBucket({ capacity: 100, refillPerSecond: 1 }),
      store: new MemoryStore({ clock: fakeClock(0) }),
      clock: fakeClock(0),
    });
    const results = await Promise.all(Array.from({ length: 1000 }, () => limiter.check("burst")));
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(100);
    expect(results.every((r) => r.limit === 100)).toBe(true);
  });

  it("keeps independent keys independent", async () => {
    const limiter = new RateLimiter({
      algorithm: new FixedWindow({ limit: 1, windowMs: 1000 }),
      clock: fakeClock(0),
    });
    await expect(limiter.check("a")).resolves.toMatchObject({ allowed: true });
    await expect(limiter.check("a")).resolves.toMatchObject({ allowed: false });
    await expect(limiter.check("b")).resolves.toMatchObject({ allowed: true });
  });

  it("peek does not consume", async () => {
    const limiter = new RateLimiter({
      algorithm: new FixedWindow({ limit: 2, windowMs: 1000 }),
      clock: fakeClock(0),
    });
    await expect(limiter.peek("u")).resolves.toMatchObject({ allowed: true, remaining: 2 });
    await limiter.check("u");
    await expect(limiter.peek("u")).resolves.toMatchObject({ remaining: 1 });
    await expect(limiter.peek("u")).resolves.toMatchObject({ remaining: 1 });
  });

  it("reset forgets a key", async () => {
    const limiter = new RateLimiter({
      algorithm: new FixedWindow({ limit: 1, windowMs: 1000 }),
      clock: fakeClock(0),
    });
    await limiter.check("u");
    await expect(limiter.check("u")).resolves.toMatchObject({ allowed: false });
    await limiter.reset("u");
    await expect(limiter.check("u")).resolves.toMatchObject({ allowed: true });
  });

  it("namespaces keys with a prefix so limiters can share a store", async () => {
    const store = new MemoryStore({ clock: fakeClock(0) });
    const a = new RateLimiter({
      algorithm: new FixedWindow({ limit: 1, windowMs: 1000 }),
      store,
      prefix: "a:",
      clock: fakeClock(0),
    });
    const b = new RateLimiter({
      algorithm: new FixedWindow({ limit: 1, windowMs: 1000 }),
      store,
      prefix: "b:",
      clock: fakeClock(0),
    });
    await expect(a.check("u")).resolves.toMatchObject({ allowed: true });
    await expect(b.check("u")).resolves.toMatchObject({ allowed: true });
    await expect(store.get("a:u")).resolves.toBeDefined();
    await expect(store.get("b:u")).resolves.toBeDefined();
  });

  it("rejects invalid costs", () => {
    const limiter = new RateLimiter({ algorithm: new FixedWindow({ limit: 1, windowMs: 1000 }) });
    expect(() => limiter.check("u", -1)).toThrow(RangeError);
    expect(() => limiter.check("u", NaN)).toThrow(RangeError);
  });

  it("falls back to a MemoryStore and the system clock", async () => {
    const limiter = new RateLimiter({
      algorithm: new TokenBucket({ capacity: 1, refillPerSecond: 1 }),
    });
    expect(limiter.store).toBeInstanceOf(MemoryStore);
    await expect(limiter.check("u")).resolves.toMatchObject({ allowed: true });
  });
});
