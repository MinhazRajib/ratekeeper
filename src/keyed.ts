import { type RateLimiter } from "./rate-limiter.js";
import { type RateLimitResult } from "./types.js";

/**
 * Groups several limiters under names (typically routes) and namespaces the
 * keys so they can safely share one store.
 *
 * ```ts
 * const limits = keyed({
 *   login: new RateLimiter({ algorithm: new FixedWindow({ limit: 5, windowMs: 60_000 }), store }),
 *   api: new RateLimiter({ algorithm: new TokenBucket({ capacity: 100, refillPerSecond: 10 }), store }),
 * });
 * await limits.check("login", ip);
 * ```
 */
export class KeyedLimiter<K extends string> {
  private readonly limiters: Readonly<Record<K, RateLimiter>>;

  constructor(limiters: Readonly<Record<K, RateLimiter>>) {
    this.limiters = limiters;
  }

  /** The limiter registered under `name`. */
  limiter(name: K): RateLimiter {
    return this.limiters[name];
  }

  /** All registered names. */
  names(): K[] {
    return Object.keys(this.limiters) as K[];
  }

  check(name: K, key: string, cost?: number): Promise<RateLimitResult> {
    return this.limiters[name].check(this.scoped(name, key), cost);
  }

  peek(name: K, key: string): Promise<RateLimitResult> {
    return this.limiters[name].peek(this.scoped(name, key));
  }

  reset(name: K, key: string): Promise<void> {
    return this.limiters[name].reset(this.scoped(name, key));
  }

  private scoped(name: K, key: string): string {
    return `${name}:${key}`;
  }
}

/** Convenience factory for `KeyedLimiter`. */
export function keyed<K extends string>(
  limiters: Readonly<Record<K, RateLimiter>>,
): KeyedLimiter<K> {
  return new KeyedLimiter(limiters);
}
