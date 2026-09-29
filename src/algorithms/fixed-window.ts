import { type Algorithm, type ConsumeOutcome } from "../types.js";
import { assertPositive, assertPositiveInteger, windowStart } from "./shared.js";

export interface FixedWindowOptions {
  /** Requests allowed per window. */
  readonly limit: number;
  /** Window length in milliseconds. Windows are aligned to multiples of this. */
  readonly windowMs: number;
}

export interface FixedWindowState {
  readonly windowStart: number;
  readonly count: number;
}

/**
 * Fixed window: a counter per aligned window that resets to zero at each
 * boundary. Cheapest to store, but permits up to `2 * limit` requests across a
 * boundary (end of one window plus start of the next).
 */
export class FixedWindow implements Algorithm<FixedWindowState> {
  readonly name = "fixed-window";
  readonly limit: number;
  private readonly windowMs: number;

  constructor(options: FixedWindowOptions) {
    assertPositiveInteger("limit", options.limit);
    assertPositive("windowMs", options.windowMs);
    this.limit = options.limit;
    this.windowMs = options.windowMs;
  }

  consume(
    state: FixedWindowState | undefined,
    now: number,
    cost: number,
  ): ConsumeOutcome<FixedWindowState> {
    const start = windowStart(now, this.windowMs);
    const count = state?.windowStart === start ? state.count : 0;
    const allowed = count + cost <= this.limit;
    const next = allowed ? count + cost : count;
    const resetMs = start + this.windowMs - now;

    return {
      state: { windowStart: start, count: next },
      result: {
        allowed,
        limit: this.limit,
        remaining: Math.max(0, this.limit - next),
        resetMs,
        retryAfterMs: allowed ? 0 : resetMs,
      },
      ttlMs: resetMs,
    };
  }
}
