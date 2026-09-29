import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/index.js";

describe("TokenBucket", () => {
  const bucket = () => new TokenBucket({ capacity: 10, refillPerSecond: 2 });

  it("starts full and reports the capacity as the limit", () => {
    const b = bucket();
    const { result, state } = b.consume(undefined, 0, 1);
    expect(b.name).toBe("token-bucket");
    expect(result).toEqual({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetMs: 500,
      retryAfterMs: 0,
    });
    expect(state).toEqual({ tokens: 9, updatedAt: 0 });
  });

  it("denies once drained and computes retryAfter from the refill rate", () => {
    const b = bucket();
    const state = b.consume(undefined, 0, 10).state;
    const denied = b.consume(state, 0, 1);
    expect(denied.result.allowed).toBe(false);
    expect(denied.result.remaining).toBe(0);
    // 1 token at 2 tokens/s takes 500 ms.
    expect(denied.result.retryAfterMs).toBe(500);
    // Fully refilling 10 tokens takes 5 s.
    expect(denied.result.resetMs).toBe(5000);
    expect(denied.ttlMs).toBe(5000);
  });

  it("refills exactly N tokens after T ms", () => {
    const b = bucket();
    const drained = b.consume(undefined, 0, 10).state;
    // 2 tokens/s * 3 s = 6 tokens.
    const after = b.consume(drained, 3000, 0);
    expect(after.result.remaining).toBe(6);
    expect(after.state.tokens).toBe(6);
  });

  it("never refills beyond capacity", () => {
    const b = bucket();
    const drained = b.consume(undefined, 0, 10).state;
    const later = b.consume(drained, 60_000, 0);
    expect(later.result.remaining).toBe(10);
    expect(later.result.resetMs).toBe(0);
  });

  it("supports weighted costs and denies a cost larger than what is available", () => {
    const b = bucket();
    const first = b.consume(undefined, 0, 7);
    expect(first.result.allowed).toBe(true);
    expect(first.result.remaining).toBe(3);
    const second = b.consume(first.state, 0, 4);
    expect(second.result.allowed).toBe(false);
    expect(second.result.remaining).toBe(3);
    expect(second.result.retryAfterMs).toBe(500);
  });

  it("ignores clocks that move backwards", () => {
    const b = bucket();
    const s = b.consume(undefined, 1000, 5).state;
    const r = b.consume(s, 500, 0);
    expect(r.result.remaining).toBe(5);
  });

  it("handles fractional refill", () => {
    const b = new TokenBucket({ capacity: 1, refillPerSecond: 0.5 });
    const s = b.consume(undefined, 0, 1).state;
    expect(b.consume(s, 1000, 1).result.allowed).toBe(false);
    expect(b.consume(s, 2000, 1).result.allowed).toBe(true);
  });

  it("validates options", () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow(RangeError);
    expect(() => new TokenBucket({ capacity: 1, refillPerSecond: -1 })).toThrow(RangeError);
    expect(() => new TokenBucket({ capacity: Infinity, refillPerSecond: 1 })).toThrow(RangeError);
  });
});
