import { describe, expect, it } from "vitest";
import { SlidingWindowLog } from "../src/index.js";

describe("SlidingWindowLog", () => {
  const log = () => new SlidingWindowLog({ limit: 3, windowMs: 1000 });

  it("records a timestamp per accepted request", () => {
    const a = log();
    let s = a.consume(undefined, 0, 1).state;
    s = a.consume(s, 100, 1).state;
    const r = a.consume(s, 200, 1);
    expect(r.state.hits).toEqual([0, 100, 200]);
    expect(r.result.remaining).toBe(0);
    expect(r.result.resetMs).toBe(800);
  });

  it("denies until the oldest hit leaves the window (exact, not approximate)", () => {
    const a = log();
    let s = a.consume(undefined, 0, 1).state;
    s = a.consume(s, 100, 1).state;
    s = a.consume(s, 200, 1).state;
    const denied = a.consume(s, 500, 1);
    expect(denied.result.allowed).toBe(false);
    expect(denied.result.retryAfterMs).toBe(500);
    expect(denied.state.hits).toEqual([0, 100, 200]);
    // At exactly 1000 the hit at 0 is out (cutoff is exclusive).
    const allowed = a.consume(denied.state, 1000, 1);
    expect(allowed.result.allowed).toBe(true);
    expect(allowed.state.hits).toEqual([100, 200, 1000]);
  });

  it("computes retryAfter for multi-unit costs from the n-th oldest hit", () => {
    const a = log();
    let s = a.consume(undefined, 0, 1).state;
    s = a.consume(s, 100, 1).state;
    s = a.consume(s, 200, 1).state;
    // Need two slots: hits at 0 and 100 must expire -> 100 + 1000 - 300.
    const r = a.consume(s, 300, 2);
    expect(r.result.allowed).toBe(false);
    expect(r.result.retryAfterMs).toBe(800);
  });

  it("stores `cost` timestamps for a weighted request", () => {
    const a = log();
    const r = a.consume(undefined, 42, 2);
    expect(r.state.hits).toEqual([42, 42]);
    expect(r.result.remaining).toBe(1);
  });

  it("reports zero reset when the log is empty", () => {
    const a = log();
    const r = a.consume(undefined, 0, 0);
    expect(r.result).toEqual({
      allowed: true,
      limit: 3,
      remaining: 3,
      resetMs: 0,
      retryAfterMs: 0,
    });
    expect(r.ttlMs).toBe(0);
  });

  it("falls back to resetMs when the cost can never fit", () => {
    const a = log();
    const s = a.consume(undefined, 0, 1).state;
    const r = a.consume(s, 10, 5);
    expect(r.result.allowed).toBe(false);
    expect(r.result.retryAfterMs).toBe(990);
  });

  it("prunes an entirely stale log", () => {
    const a = log();
    const s = a.consume(undefined, 0, 3).state;
    const r = a.consume(s, 5000, 1);
    expect(r.state.hits).toEqual([5000]);
  });

  it("validates options", () => {
    expect(() => new SlidingWindowLog({ limit: -1, windowMs: 1000 })).toThrow(RangeError);
    expect(() => new SlidingWindowLog({ limit: 1, windowMs: NaN })).toThrow(RangeError);
  });
});
