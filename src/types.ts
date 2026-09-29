/**
 * A clock returns the current time in milliseconds. Injecting one makes every
 * algorithm and store deterministic under test.
 */
export type Clock = () => number;

/** The default clock used everywhere a `clock` option is omitted. */
export const systemClock: Clock = () => Date.now();

/** Outcome of a single rate-limit check. */
export interface RateLimitResult {
  /** Whether the request may proceed. */
  readonly allowed: boolean;
  /** The configured ceiling for this key (`RateLimit-Limit`). */
  readonly limit: number;
  /** Requests still available in the current window/bucket (`RateLimit-Remaining`). */
  readonly remaining: number;
  /** Milliseconds until the limit fully resets (`RateLimit-Reset`, in seconds on the wire). */
  readonly resetMs: number;
  /** Milliseconds the caller should wait before retrying; `0` when allowed (`Retry-After`). */
  readonly retryAfterMs: number;
}

/** What an algorithm hands back after one pure `consume` step. */
export interface ConsumeOutcome<S> {
  /** The next state to persist for this key. */
  readonly state: S;
  /** The decision for this request. */
  readonly result: RateLimitResult;
  /**
   * How long the state stays meaningful. Stores may drop the key after this
   * many milliseconds because a fresh state would produce the same decisions.
   */
  readonly ttlMs: number;
}

/**
 * A rate-limiting algorithm is a pure state machine: given the previous state
 * (or `undefined` for a new key), the current time and a cost, it returns the
 * next state and the decision. No I/O, no clocks, no side effects. That is what
 * makes the algorithms trivially testable and lets stores apply them atomically.
 */
export interface Algorithm<S = unknown> {
  /** Short identifier, useful for logging and benchmarks. */
  readonly name: string;
  /** The ceiling reported in results and headers. */
  readonly limit: number;
  consume(state: S | undefined, now: number, cost: number): ConsumeOutcome<S>;
}

/**
 * Storage for per-key algorithm state.
 *
 * The single mutating primitive is `update`: a read-modify-write that must be
 * applied atomically per key. Because algorithms are pure, a store only has to
 * guarantee that `fn` runs against the latest state and that its returned
 * state is what the next call sees. `MemoryStore` serializes calls per key with
 * a promise chain; `RedisStore` uses a compare-and-set Lua script.
 */
export interface Store {
  /** Read the raw state for a key, or `undefined` if absent or expired. */
  get<S>(key: string): Promise<S | undefined>;
  /**
   * Atomically transform the state for `key`. `fn` must be synchronous and
   * pure; it may be re-invoked by stores that retry on write conflicts.
   */
  update<S, R>(key: string, fn: (current: S | undefined) => UpdateOutcome<S, R>): Promise<R>;
  /** Remove a key entirely. */
  delete(key: string): Promise<void>;
}

/** Return shape for `Store.update` callbacks. */
export interface UpdateOutcome<S, R> {
  readonly state: S;
  readonly ttlMs: number;
  readonly result: R;
}
