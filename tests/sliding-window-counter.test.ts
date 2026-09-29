import { describe, expect, it } from "vitest";
import { SlidingWindowCounter } from "../src/index.js";

describe("SlidingWindowCounter", () => {
  const counter = () => new SlidingWindowCounter({ limit: 10, windowMs: 1000 });

  it("weights the previous window by its remaining overlap", () => {
    const a = counter();
    // Fill the previous window completely.
    const prev = a.consume(undefined, 500, 10).state;
    expect(prev).toEqual({ windowStart: 0, current: 10, previous: 0 });

    // At the boundary the previous window still counts fully.
    const atBoundary = a.consume(prev, 1000, 1);
    expect(atBoundary.result.allowed).toBe(false);
    expect(atBoundary.result.remaining).toBe(0);
    expect(atBoundary.state).toEqual({ windowStart: 1000, current: 0, previous: 10 });

    // Halfway through, only half of the previous window overlaps: 10 * 0.5 = 5 used.
    const half = a.consume(atBoundary.state, 1500, 0);
    expect(half.result.remaining).toBe(5);

    let s = half.state;
    for (let i = 0; i < 5; i += 1) {
      const r = a.consume(s, 1500, 1);
      expect(r.result.allowed).toBe(true);
      s = r.state;
    }
    const sixth = a.consume(s, 1500, 1);
    expect(sixth.result.allowed).toBe(false);
    // Fits once weight drops to 0.4: at t = 1600.
    expect(sixth.result.retryAfterMs).toBe(100);
    expect(a.consume(sixth.state, 1600, 1).result.allowed).toBe(true);
  });

  it("drops the previous window entirely after a gap of two windows", () => {
    const a = counter();
    const s = a.consume(undefined, 0, 10).state;
    const r = a.consume(s, 2000, 1);
    expect(r.state).toEqual({ windowStart: 2000, current: 1, previous: 0 });
    expect(r.result.remaining).toBe(9);
  });

  it("reports reset as the time until all counts have decayed", () => {
    const a = counter();
    const withCurrent = a.consume(undefined, 250, 1);
    expect(withCurrent.result.resetMs).toBe(1750);
    expect(withCurrent.ttlMs).toBe(1750);
    const onlyPrevious = a.consume(withCurrent.state, 1250, 0);
    expect(onlyPrevious.result.resetMs).toBe(750);
    const empty = a.consume(undefined, 0, 0);
    expect(empty.result.resetMs).toBe(0);
  });

  it("computes retryAfter that spills into the next window", () => {
    const a = counter();
    // Current window is full; nothing in previous. Cost fits only once current decays.
    const s = a.consume(undefined, 0, 10).state;
    const r = a.consume(s, 0, 1);
    expect(r.result.allowed).toBe(false);
    // Next window starts at 1000; need weight <= 0.9 -> t = 1000 + 100.
    expect(r.result.retryAfterMs).toBe(1100);
    expect(a.consume(r.state, 1100, 1).result.allowed).toBe(true);
    expect(a.consume(r.state, 1099, 1).result.allowed).toBe(false);
  });

  it("falls back to resetMs when the cost exceeds the limit", () => {
    const a = counter();
    const s = a.consume(undefined, 0, 1).state;
    const r = a.consume(s, 0, 11);
    expect(r.result.allowed).toBe(false);
    expect(r.result.retryAfterMs).toBe(2000);
  });

  it("validates options", () => {
    expect(() => new SlidingWindowCounter({ limit: 0, windowMs: 1000 })).toThrow(RangeError);
    expect(() => new SlidingWindowCounter({ limit: 1, windowMs: -5 })).toThrow(RangeError);
  });
});
