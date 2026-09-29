# ratekeeper

Small, fully typed rate limiting for Node and edge runtimes: four algorithms behind one interface, pluggable stores, framework adapters, zero dependencies.

[![CI](https://github.com/MinhazRajib/ratekeeper/actions/workflows/ci.yml/badge.svg)](https://github.com/MinhazRajib/ratekeeper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.json)

## Install

```sh
npm i ratekeeper
```

Not on npm yet. Until it is: `npm i github:MinhazRajib/ratekeeper`.

Requires Node 18+ (or any runtime with `Promise` and, for the fetch adapter, `Request`/`Response`).

## Quickstart

```ts
import { RateLimiter, TokenBucket, MemoryStore } from "ratekeeper";

const limiter = new RateLimiter({
  algorithm: new TokenBucket({ capacity: 100, refillPerSecond: 10 }),
  store: new MemoryStore(),
});

const res = await limiter.check("user:42");
// { allowed: true, limit: 100, remaining: 99, resetMs: 100, retryAfterMs: 0 }

if (!res.allowed) {
  console.log(`try again in ${res.retryAfterMs} ms`);
}
```

## Choosing an algorithm

| Algorithm              | Burst tolerance                        | Memory per key     | Accuracy                          | Best for                                                    |
| ---------------------- | -------------------------------------- | ------------------ | --------------------------------- | ----------------------------------------------------------- |
| `TokenBucket`          | Up to `capacity`, then smooth refill   | 2 numbers          | Exact for a rate + burst contract | APIs where short bursts are fine but sustained rate is not  |
| `FixedWindow`          | Up to `2 × limit` across a boundary    | 2 numbers          | Coarse (boundary burst)           | Cheap coarse quotas, e.g. "5 password attempts per minute"  |
| `SlidingWindowLog`     | None beyond `limit` in any window      | `O(limit)` numbers | Exact                             | Small limits where precision matters (login, OTP, payments) |
| `SlidingWindowCounter` | Slight, from weighting the last window | 3 numbers          | Approximate (assumes even spread) | High-traffic endpoints that need smoothness without the log |

All four report the same result shape, so you can swap them without touching call sites.

## API

### `new RateLimiter(options)`

| Option      | Type           | Default             | Notes                                                |
| ----------- | -------------- | ------------------- | ---------------------------------------------------- |
| `algorithm` | `Algorithm`    | required            | Any of the four above, or your own                   |
| `store`     | `Store`        | `new MemoryStore()` | `MemoryStore`, `RedisStore`, or your own             |
| `clock`     | `() => number` | `Date.now`          | Inject for deterministic tests                       |
| `prefix`    | `string`       | `""`                | Prepended to every key so limiters can share a store |

- `check(key, cost = 1): Promise<RateLimitResult>` — consume `cost` units. State is persisted even on denial.
- `peek(key): Promise<RateLimitResult>` — current standing without consuming.
- `reset(key): Promise<void>` — forget the key.
- `limit: number` — the configured ceiling.

### `RateLimitResult`

```ts
interface RateLimitResult {
  allowed: boolean;
  limit: number; // RateLimit-Limit
  remaining: number; // RateLimit-Remaining
  resetMs: number; // ms until the limit is fully restored (RateLimit-Reset, in seconds on the wire)
  retryAfterMs: number; // ms to wait before retrying; 0 when allowed (Retry-After)
}
```

### Algorithms

```ts
new TokenBucket({ capacity: 100, refillPerSecond: 10 });
new FixedWindow({ limit: 100, windowMs: 60_000 });
new SlidingWindowLog({ limit: 10, windowMs: 60_000 });
new SlidingWindowCounter({ limit: 100, windowMs: 60_000 });
```

Every algorithm implements a single pure method, `consume(state, now, cost)`, returning the next state, the decision and a TTL. No I/O, no clocks. To add your own, implement `Algorithm<S>`.

### Stores

- `new MemoryStore({ maxKeys?, sweepIntervalMs?, clock? })` — in-process. Expired keys are dropped lazily on access (and by an optional `unref`'d sweeper). `maxKeys` (default 10 000) bounds memory with LRU eviction.
- `new RedisStore(client, { prefix?, maxRetries? })` — takes any client exposing ioredis-style `get`, `set(key, value, "PX", ms)`, `del` and `eval(script, numKeys, ...args)`. **Unit-tested against an in-memory fake client only; not yet run against a live Redis in CI.**

Implement `Store` (`get`, `update`, `delete`) for anything else, e.g. Cloudflare KV, Durable Objects, Postgres.

### Adapters

```ts
import { expressRateLimit, fetchRateLimit } from "ratekeeper";

// Express / plain http: 429 + JSON body when limited, RateLimit-* headers always.
app.use(expressRateLimit(limiter, { keyFn: (req) => req.ip ?? "unknown" }));

// Fetch API (Cloudflare Workers, Bun, Deno, Next.js route handlers). Extra args pass through.
export default { fetch: fetchRateLimit(limiter)(async (request, env, ctx) => new Response("ok")) };
```

Both set `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds) and, on 429, `Retry-After` (seconds, minimum 1). Options: `keyFn` (default: first `x-forwarded-for` hop, then `cf-connecting-ip`, `x-real-ip`, then `req.ip`), `cost` (number or function), `onLimited` (custom 429), `headers: false` to skip headers on allowed responses, `failOpen` (default `true`: a store error lets the request through).

### Per-route limits

```ts
const limits = keyed({
  login: new RateLimiter({
    algorithm: new SlidingWindowLog({ limit: 5, windowMs: 60_000 }),
    store,
  }),
  api: new RateLimiter({
    algorithm: new TokenBucket({ capacity: 100, refillPerSecond: 10 }),
    store,
  }),
});
await limits.check("login", ip); // stored under "login:<ip>"
```

## Stores and atomicity

Because every algorithm is a pure function of `(state, now, cost)`, a store only needs one primitive: `update(key, fn)`, an atomic read-modify-write. `MemoryStore` serializes updates per key through a promise chain (`KeyedMutex`), so 1 000 concurrent `check` calls against a capacity of 100 admit exactly 100 (there is a test for that). `RedisStore` keeps the same in-process mutex and adds an optimistic compare-and-set across processes: it reads the JSON state, runs the algorithm locally, then a Lua script writes the new value only if Redis still holds the value it read, retrying with fresh state on conflict. The trade-off versus running each algorithm in Lua is one extra round trip per check, in exchange for a single algorithm implementation to test.

## Benchmarks

`RateLimiter.check` with `MemoryStore`, 1 000 rotating keys, Apple Silicon Mac, Node 25 (`npm run bench`):

| Algorithm              | ops/sec   | mean   |
| ---------------------- | --------- | ------ |
| `FixedWindow`          | 1,648,655 | 0.6 µs |
| `SlidingWindowCounter` | 1,457,320 | 0.7 µs |
| `TokenBucket`          | 1,262,117 | 0.8 µs |
| `SlidingWindowLog`     | 1,124,197 | 0.9 µs |

The store, not the algorithm, will dominate in production; over the network a Redis round trip costs more than all four combined.

## Testing

Everything that touches time takes a `clock: () => number`, so the test suite runs against a fake clock and asserts exact numbers: a bucket refills precisely 6 tokens after 3 s at 2/s, the sliding counter weights the previous window to exactly 5 of 10 at the halfway point, a fixed window resets at the boundary and not a millisecond before. Concurrency is tested by firing 1 000 simultaneous checks against both stores. `RedisStore` runs against a small fake that implements the same `get`/`set`/`del`/`eval` contract, including simulated writes from another process. Run `npm test` or `npm run test:coverage`.

## Why I built this

I kept reimplementing the same rate limiter in every service and never had time to test the edge cases properly, so I wanted one place where the math is isolated, pure and proven. Making the algorithms pure and the clock injectable turned out to be the whole trick; everything else is plumbing.

## Roadmap

- Native Lua implementations of each algorithm for `RedisStore`, removing the compare-and-set round trip.
- A Cloudflare Durable Objects store and an integration test against a real Redis in CI.
- A `dryRun` mode that reports what would have been limited without enforcing it.

## License

MIT © 2026 Minhaz Rajib
