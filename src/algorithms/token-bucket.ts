import { type Algorithm, type ConsumeOutcome } from "../types.js";
import { assertPositive } from "./shared.js";

export interface TokenBucketOptions {
  /** Maximum tokens the bucket holds; also the burst size. */
  readonly capacity: number;
  /** Tokens added per second (fractional values are fine). */
  readonly refillPerSecond: number;
}

export interface TokenBucketState {
  /** Tokens available as of `updatedAt`. */
  readonly tokens: number;
  /** Timestamp (ms) at which `tokens` was computed. */
  readonly updatedAt: number;
}

/**
 * Token bucket: the bucket refills continuously at `refillPerSecond` up to
 * `capacity`; each request removes `cost` tokens. Allows bursts up to the
 * capacity and then smooths to the refill rate.
 */
export class TokenBucket implements Algorithm<TokenBucketState> {
  readonly name = "token-bucket";
  readonly limit: number;
  private readonly refillPerMs: number;

  constructor(options: TokenBucketOptions) {
    assertPositive("capacity", options.capacity);
    assertPositive("refillPerSecond", options.refillPerSecond);
    this.limit = options.capacity;
    this.refillPerMs = options.refillPerSecond / 1000;
  }

  consume(
    state: TokenBucketState | undefined,
    now: number,
    cost: number,
  ): ConsumeOutcome<TokenBucketState> {
    const elapsed = state === undefined ? 0 : Math.max(0, now - state.updatedAt);
    const available =
      state === undefined
        ? this.limit
        : Math.min(this.limit, state.tokens + elapsed * this.refillPerMs);

    const allowed = available >= cost;
    const tokens = allowed ? available - cost : available;
    const resetMs = Math.ceil((this.limit - tokens) / this.refillPerMs);
    const retryAfterMs = allowed ? 0 : Math.ceil((cost - tokens) / this.refillPerMs);

    return {
      state: { tokens, updatedAt: now },
      result: {
        allowed,
        limit: this.limit,
        remaining: Math.floor(tokens),
        resetMs,
        retryAfterMs,
      },
      ttlMs: resetMs,
    };
  }
}
