import { type Algorithm, type ConsumeOutcome } from "../types.js";
import { assertPositive, assertPositiveInteger } from "./shared.js";

export interface SlidingWindowLogOptions {
  /** Requests allowed in any trailing window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

export interface SlidingWindowLogState {
  /** Ascending timestamps of accepted requests still inside the window. */
  readonly hits: readonly number[];
}

/**
 * Sliding window log: stores a timestamp per accepted request and counts the
 * ones inside the trailing window. Exact, at the price of `O(limit)` memory
 * per key.
 */
export class SlidingWindowLog implements Algorithm<SlidingWindowLogState> {
  readonly name = "sliding-window-log";
  readonly limit: number;
  private readonly windowMs: number;

  constructor(options: SlidingWindowLogOptions) {
    assertPositiveInteger("limit", options.limit);
    assertPositive("windowMs", options.windowMs);
    this.limit = options.limit;
    this.windowMs = options.windowMs;
  }

  consume(
    state: SlidingWindowLogState | undefined,
    now: number,
    cost: number,
  ): ConsumeOutcome<SlidingWindowLogState> {
    const cutoff = now - this.windowMs;
    // Hits are ascending, so find the first live one and slice once.
    const previous = state?.hits ?? [];
    let firstLive = 0;
    for (const hit of previous) {
      if (hit > cutoff) break;
      firstLive += 1;
    }
    const live = firstLive === 0 ? previous : previous.slice(firstLive);

    const allowed = live.length + cost <= this.limit;
    let hits = live;
    if (allowed && cost > 0) {
      const added = new Array<number>(cost).fill(now);
      hits = live.concat(added);
    }

    const oldest = hits[0];
    const resetMs = oldest === undefined ? 0 : oldest + this.windowMs - now;

    let retryAfterMs = 0;
    if (!allowed) {
      // We need `need` of the oldest hits to expire before `cost` fits.
      const need = Math.min(hits.length, hits.length + cost - this.limit);
      const gate = hits[need - 1];
      retryAfterMs = gate === undefined ? resetMs : Math.max(1, gate + this.windowMs - now);
    }

    return {
      state: { hits },
      result: {
        allowed,
        limit: this.limit,
        remaining: Math.max(0, this.limit - hits.length),
        resetMs,
        retryAfterMs,
      },
      ttlMs: resetMs,
    };
  }
}
