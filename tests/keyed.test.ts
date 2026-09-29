import { describe, expect, it } from "vitest";
import { FixedWindow, KeyedLimiter, MemoryStore, RateLimiter, keyed } from "../src/index.js";
import { fakeClock } from "./helpers.js";

describe("keyed", () => {
  const build = () => {
    const clock = fakeClock(0);
    const store = new MemoryStore({ clock });
    const limits = keyed({
      login: new RateLimiter({
        algorithm: new FixedWindow({ limit: 1, windowMs: 60_000 }),
        store,
        clock,
      }),
      api: new RateLimiter({
        algorithm: new FixedWindow({ limit: 3, windowMs: 1000 }),
        store,
        clock,
      }),
    });
    return { limits, store };
  };

  it("applies per-name limits and namespaces keys in the shared store", async () => {
    const { limits, store } = build();
    expect(limits).toBeInstanceOf(KeyedLimiter);
    expect(limits.names().sort()).toEqual(["api", "login"]);
    await expect(limits.check("login", "ip1")).resolves.toMatchObject({ allowed: true });
    await expect(limits.check("login", "ip1")).resolves.toMatchObject({ allowed: false });
    // Same raw key, different route, different budget.
    await expect(limits.check("api", "ip1")).resolves.toMatchObject({ allowed: true, limit: 3 });
    await expect(store.get("login:ip1")).resolves.toBeDefined();
    await expect(store.get("api:ip1")).resolves.toBeDefined();
  });

  it("exposes peek, reset and the underlying limiter", async () => {
    const { limits } = build();
    await limits.check("api", "ip1", 2);
    await expect(limits.peek("api", "ip1")).resolves.toMatchObject({ remaining: 1 });
    await limits.reset("api", "ip1");
    await expect(limits.peek("api", "ip1")).resolves.toMatchObject({ remaining: 3 });
    expect(limits.limiter("api").limit).toBe(3);
  });
});
