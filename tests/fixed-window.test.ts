import { describe, expect, it } from "vitest";
import { FixedWindow } from "../src/index.js";

describe("FixedWindow", () => {
  const fw = () => new FixedWindow({ limit: 3, windowMs: 1000 });

  it("allows up to the limit inside a window", () => {
    const a = fw();
    let state = a.consume(undefined, 100, 1).state;
    state = a.consume(state, 200, 1).state;
    const third = a.consume(state, 300, 1);
    expect(third.result).toEqual({
      allowed: true,
      limit: 3,
      remaining: 0,
      resetMs: 700,
      retryAfterMs: 0,
    });
    const fourth = a.consume(third.state, 400, 1);
    expect(fourth.result.allowed).toBe(false);
    expect(fourth.result.remaining).toBe(0);
    expect(fourth.result.retryAfterMs).toBe(600);
    expect(fourth.result.resetMs).toBe(600);
    expect(fourth.ttlMs).toBe(600);
    expect(fourth.state.count).toBe(3);
  });

  it("resets the counter at the window boundary", () => {
    const a = fw();
    let state = a.consume(undefined, 0, 3).state;
    expect(a.consume(state, 999, 1).result.allowed).toBe(false);
    const fresh = a.consume(state, 1000, 1);
    expect(fresh.result.allowed).toBe(true);
    expect(fresh.result.remaining).toBe(2);
    expect(fresh.state).toEqual({ windowStart: 1000, count: 1 });
    state = fresh.state;
    // Skipping several windows also resets.
    expect(a.consume(state, 5500, 3).result.allowed).toBe(true);
  });

  it("aligns windows to multiples of windowMs, not to the first request", () => {
    const a = fw();
    const s = a.consume(undefined, 950, 1);
    expect(s.state.windowStart).toBe(0);
    expect(s.result.resetMs).toBe(50);
  });

  it("denies a cost above the limit without corrupting the count", () => {
    const a = fw();
    const r = a.consume(undefined, 0, 4);
    expect(r.result.allowed).toBe(false);
    expect(r.state.count).toBe(0);
    expect(r.result.remaining).toBe(3);
  });

  it("validates options", () => {
    expect(() => new FixedWindow({ limit: 0, windowMs: 1000 })).toThrow(RangeError);
    expect(() => new FixedWindow({ limit: 1.5, windowMs: 1000 })).toThrow(RangeError);
    expect(() => new FixedWindow({ limit: 1, windowMs: 0 })).toThrow(RangeError);
  });
});
