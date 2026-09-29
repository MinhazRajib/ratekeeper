import { type Algorithm, type ConsumeOutcome } from "../types.js";
import { assertPositive, assertPositiveInteger, windowStart } from "./shared.js";

export interface SlidingWindowCounterOptions {
  /** Requests allowed in any trailing window (estimated). */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

export interface SlidingWindowCounterState {
  /** Start of the current aligned window. */
  readonly windowStart: number;
  /** Requests accepted in the current window. */
  readonly current: number;
  /** Requests accepted in the previous window. */
  readonly previous: number;
}

/**
 * Sliding window counter: keeps two fixed-window counters and weights the
 * previous one by how much of it still overlaps the trailing window:
 *
 *   estimate = previous * (1 - elapsed / windowMs) + current
 *
 * Constant memory per key and no boundary burst like the fixed window; the
 * trade-off is that it assumes requests in the previous window were spread
 * evenly, so it can be slightly off in either direction.
 */
export class SlidingWindowCounter implements Algorithm<SlidingWindowCounterState> {
  readonly name = "sliding-window-counter";
  readonly limit: number;
  private readonly windowMs: number;

  constructor(options: SlidingWindowCounterOptions) {
    assertPositiveInteger("limit", options.limit);
    assertPositive("windowMs", options.windowMs);
    this.limit = options.limit;
    this.windowMs = options.windowMs;
  }

  consume(
    state: SlidingWindowCounterState | undefined,
    now: number,
    cost: number,
  ): ConsumeOutcome<SlidingWindowCounterState> {
    const w = this.windowMs;
    const start = windowStart(now, w);

    let previous = 0;
    let current = 0;
    if (state !== undefined) {
      if (state.windowStart === start) {
        previous = state.previous;
        current = state.current;
      } else if (state.windowStart === start - w) {
        previous = state.current;
      }
    }

    const elapsed = now - start;
    const weight = (w - elapsed) / w;
    const estimate = previous * weight + current;
    const allowed = estimate + cost <= this.limit;
    if (allowed) current += cost;

    const used = previous * weight + current;
    const remaining = Math.max(0, Math.floor(this.limit - used));

    let resetMs = 0;
    if (current > 0) resetMs = start + 2 * w - now;
    else if (previous > 0) resetMs = start + w - now;

    let retryAfterMs = 0;
    if (!allowed) {
      retryAfterMs = this.timeUntilFits(start, now, previous, current, cost, resetMs);
    }

    return {
      state: { windowStart: start, current, previous },
      result: { allowed, limit: this.limit, remaining, resetMs, retryAfterMs },
      ttlMs: resetMs,
    };
  }

  /**
   * Earliest delay after which `cost` would fit, assuming no further traffic.
   * Solves the weighted estimate for time inside the current window first, then
   * inside the next window (where today's `current` becomes the decaying
   * `previous`).
   */
  private timeUntilFits(
    start: number,
    now: number,
    previous: number,
    current: number,
    cost: number,
    resetMs: number,
  ): number {
    const w = this.windowMs;
    const room = this.limit - current - cost;
    if (room >= 0 && previous > 0) {
      const targetWeight = room / previous;
      const at = start + w * (1 - targetWeight);
      return Math.max(1, Math.ceil(at - now));
    }
    const nextRoom = this.limit - cost;
    if (nextRoom >= 0 && current > 0) {
      const targetWeight = nextRoom / current;
      const at = start + w + w * (1 - targetWeight);
      return Math.max(1, Math.ceil(at - now));
    }
    // Cost exceeds the limit outright: it can only fit once everything drains.
    return Math.max(1, resetMs);
  }
}
