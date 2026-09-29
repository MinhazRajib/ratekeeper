import { describe, expect, it } from "vitest";
import { RateLimiter, RedisConflictError, RedisStore, TokenBucket } from "../src/index.js";
import { FakeRedis, fakeClock } from "./helpers.js";

describe("RedisStore (against an in-memory fake client)", () => {
  it("stores JSON under a prefixed key with a TTL and returns the callback result", async () => {
    const clock = fakeClock(0);
    const redis = new FakeRedis(clock);
    const store = new RedisStore(redis, { prefix: "rl:" });
    const out = await store.update<{ n: number }, string>("k", (current) => ({
      state: { n: (current?.n ?? 0) + 1 },
      ttlMs: 500,
      result: "done",
    }));
    expect(out).toBe("done");
    expect(redis.data.get("rl:k")?.value).toBe('{"n":1}');
    await expect(store.get<{ n: number }>("k")).resolves.toEqual({ n: 1 });
    clock.advance(500);
    await expect(store.get("k")).resolves.toBeUndefined();
  });

  it("uses GET + EVAL (compare-and-set), never a plain SET", async () => {
    const redis = new FakeRedis(fakeClock());
    const store = new RedisStore(redis);
    await store.update("k", () => ({ state: 1, ttlMs: 100, result: null }));
    expect(redis.calls).toEqual(["get", "eval"]);
    expect(redis.data.has("ratekeeper:k")).toBe(true);
  });

  it("retries with fresh state when another writer wins the race", async () => {
    const redis = new FakeRedis(fakeClock());
    const store = new RedisStore(redis);
    await store.update("k", () => ({ state: { n: 1 }, ttlMs: 1000, result: null }));

    let interference = 1;
    redis.afterGet = (key) => {
      if (interference > 0) {
        interference -= 1;
        redis.data.set(key, { value: '{"n":41}', expiresAt: Number.MAX_SAFE_INTEGER });
      }
    };
    const seen: number[] = [];
    const result = await store.update<{ n: number }, number>("k", (current) => {
      const n = current?.n ?? 0;
      seen.push(n);
      return { state: { n: n + 1 }, ttlMs: 1000, result: n + 1 };
    });
    // First attempt saw 1 and lost; second saw the interfering 41 and won.
    expect(seen).toEqual([1, 41]);
    expect(result).toBe(42);
    expect(redis.data.get("ratekeeper:k")?.value).toBe('{"n":42}');
  });

  it("gives up after maxRetries with a RedisConflictError", async () => {
    const redis = new FakeRedis(fakeClock());
    let n = 0;
    redis.afterGet = (key) => {
      n += 1;
      redis.data.set(key, { value: String(n), expiresAt: Number.MAX_SAFE_INTEGER });
    };
    const store = new RedisStore(redis, { maxRetries: 3 });
    await expect(store.update("k", () => ({ state: 0, ttlMs: 1, result: null }))).rejects.toThrow(
      RedisConflictError,
    );
    expect(redis.calls.filter((c) => c === "eval")).toHaveLength(3);
  });

  it("never sends a zero TTL (Redis rejects PX 0)", async () => {
    const redis = new FakeRedis(fakeClock());
    const store = new RedisStore(redis);
    await expect(store.update("k", () => ({ state: 1, ttlMs: 0, result: "ok" }))).resolves.toBe(
      "ok",
    );
  });

  it("deletes keys", async () => {
    const redis = new FakeRedis(fakeClock());
    const store = new RedisStore(redis);
    await store.update("k", () => ({ state: 1, ttlMs: 1000, result: null }));
    await store.delete("k");
    expect(redis.calls.at(-1)).toBe("del");
    await expect(store.get("k")).resolves.toBeUndefined();
  });

  it("admits exactly `capacity` of 1000 concurrent checks through a RateLimiter", async () => {
    const clock = fakeClock(0);
    const limiter = new RateLimiter({
      algorithm: new TokenBucket({ capacity: 100, refillPerSecond: 1 }),
      store: new RedisStore(new FakeRedis(clock)),
      clock,
    });
    const results = await Promise.all(Array.from({ length: 1000 }, () => limiter.check("burst")));
    expect(results.filter((r) => r.allowed)).toHaveLength(100);
  });

  it("validates options", () => {
    expect(() => new RedisStore(new FakeRedis(fakeClock()), { maxRetries: 0 })).toThrow(RangeError);
  });
});
