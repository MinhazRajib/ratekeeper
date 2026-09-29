import { type Store, type UpdateOutcome } from "../types.js";
import { KeyedMutex } from "./keyed-mutex.js";

/**
 * The subset of a Redis client this store needs. Both `ioredis` and
 * `node-redis` (v4, via `client.eval(script, { keys, arguments })` wrapped by
 * the caller) can satisfy it. Duck-typed on purpose: this package has no
 * dependency on any Redis client.
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /** ioredis-style: `eval(script, numKeys, ...keys, ...args)`. */
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export interface RedisStoreOptions {
  /** Prefix applied to every key, e.g. `"rl:"`. Defaults to `"ratekeeper:"`. */
  readonly prefix?: string;
  /** Max compare-and-set attempts before giving up. Defaults to `16`. */
  readonly maxRetries?: number;
}

/**
 * Compare-and-set: write `new` with TTL only if the key still holds `expected`
 * (or is absent when `expected` is the empty sentinel). Returns 1 on success.
 */
export const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false then current = '' end
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`.trim();

export class RedisConflictError extends Error {
  constructor(key: string, attempts: number) {
    super(`RedisStore: gave up on "${key}" after ${attempts} compare-and-set attempts`);
    this.name = "RedisConflictError";
  }
}

/**
 * Redis-backed store.
 *
 * Atomicity comes from two layers. Within one process, a `KeyedMutex`
 * serializes updates per key, so local callers never race each other. Across
 * processes, each update is an optimistic compare-and-set executed as a Lua
 * script: read the current JSON, run the pure algorithm step locally, then
 * write back only if the value in Redis is unchanged. On conflict the update is
 * retried with fresh state.
 *
 * NOTE: this store is unit-tested against an in-memory fake client that
 * implements the same contract. It has not been run against a live Redis in
 * CI. Treat it as a reference implementation and verify against your deployment.
 */
export class RedisStore implements Store {
  private readonly client: RedisLikeClient;
  private readonly prefix: string;
  private readonly maxRetries: number;
  private readonly mutex = new KeyedMutex();

  constructor(client: RedisLikeClient, options: RedisStoreOptions = {}) {
    this.client = client;
    this.prefix = options.prefix ?? "ratekeeper:";
    this.maxRetries = options.maxRetries ?? 16;
    if (this.maxRetries < 1) throw new RangeError("RedisStore: maxRetries must be >= 1");
  }

  async get<S>(key: string): Promise<S | undefined> {
    const raw = await this.client.get(this.prefix + key);
    return raw === null ? undefined : (JSON.parse(raw) as S);
  }

  update<S, R>(key: string, fn: (current: S | undefined) => UpdateOutcome<S, R>): Promise<R> {
    const fullKey = this.prefix + key;
    return this.mutex.run(key, async () => {
      for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
        const raw = await this.client.get(fullKey);
        const current = raw === null ? undefined : (JSON.parse(raw) as S);
        const outcome = fn(current);
        // Redis rejects PX 0; a 1 ms TTL is equivalent to "expire immediately".
        const ttl = Math.max(1, Math.ceil(outcome.ttlMs));
        const ok = await this.client.eval(
          CAS_SCRIPT,
          1,
          fullKey,
          raw ?? "",
          JSON.stringify(outcome.state),
          String(ttl),
        );
        if (ok === 1) return outcome.result;
      }
      throw new RedisConflictError(key, this.maxRetries);
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.prefix + key);
  }
}
