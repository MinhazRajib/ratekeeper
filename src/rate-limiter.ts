import { MemoryStore } from "./stores/memory-store.js";
import {
  type Algorithm,
  type Clock,
  type RateLimitResult,
  type Store,
  systemClock,
} from "./types.js";

export interface RateLimiterOptions<S> {
  /** The algorithm deciding admission. */
  readonly algorithm: Algorithm<S>;
  /** Where per-key state lives. Defaults to a fresh `MemoryStore`. */
  readonly store?: Store;
  /** Injectable time source for deterministic tests. Defaults to `Date.now`. */
  readonly clock?: Clock;
  /** Optional namespace prepended to every key, e.g. `"login:"`. */
  readonly prefix?: string;
}

/**
 * Binds an algorithm to a store and a clock. Each `check` is one atomic
 * `store.update` that runs the algorithm's pure `consume` step.
 */
export class RateLimiter<S = unknown> {
  readonly algorithm: Algorithm<S>;
  readonly store: Store;
  private readonly clock: Clock;
  private readonly prefix: string;

  constructor(options: RateLimiterOptions<S>) {
    this.algorithm = options.algorithm;
    this.store = options.store ?? new MemoryStore();
    this.clock = options.clock ?? systemClock;
    this.prefix = options.prefix ?? "";
  }

  /** The configured ceiling, as reported in `RateLimit-Limit`. */
  get limit(): number {
    return this.algorithm.limit;
  }

  /**
   * Try to consume `cost` units for `key`. Always persists the resulting state,
   * even when denied, so refill/decay bookkeeping stays current.
   */
  check(key: string, cost = 1): Promise<RateLimitResult> {
    if (!Number.isFinite(cost) || cost < 0) {
      throw new RangeError(`cost must be a finite number >= 0, got ${String(cost)}`);
    }
    const now = this.clock();
    return this.store.update<S, RateLimitResult>(this.prefix + key, (state) => {
      const outcome = this.algorithm.consume(state, now, cost);
      return { state: outcome.state, ttlMs: outcome.ttlMs, result: outcome.result };
    });
  }

  /** Inspect the current standing of `key` without consuming anything. */
  async peek(key: string): Promise<RateLimitResult> {
    const state = await this.store.get<S>(this.prefix + key);
    return this.algorithm.consume(state, this.clock(), 0).result;
  }

  /** Forget everything about `key`. */
  reset(key: string): Promise<void> {
    return this.store.delete(this.prefix + key);
  }
}
