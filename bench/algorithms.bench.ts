/**
 * Throughput of `RateLimiter.check` per algorithm with a MemoryStore.
 * Run with `npm run bench` (vitest bench, tinybench underneath).
 *
 * Each iteration hits a rotating set of 1,000 keys so the store's Map and the
 * per-key mutex are exercised the way they would be under real traffic, not
 * just a single hot key.
 */
import { bench, describe } from "vitest";
import {
  type Algorithm,
  FixedWindow,
  MemoryStore,
  RateLimiter,
  SlidingWindowCounter,
  SlidingWindowLog,
  TokenBucket,
} from "../src/index.js";

const KEYS = 1000;
const keys = Array.from({ length: KEYS }, (_, i) => `user:${i}`);

function setup(algorithm: Algorithm): () => Promise<void> {
  const limiter = new RateLimiter({ algorithm, store: new MemoryStore({ maxKeys: Infinity }) });
  let i = 0;
  return async () => {
    i = (i + 1) % KEYS;
    await limiter.check(keys[i] ?? "user:0");
  };
}

describe("RateLimiter.check with MemoryStore, 1000 rotating keys", () => {
  bench(
    "TokenBucket (capacity 100, 50/s)",
    setup(new TokenBucket({ capacity: 100, refillPerSecond: 50 })),
  );
  bench("FixedWindow (100 per 1s)", setup(new FixedWindow({ limit: 100, windowMs: 1000 })));
  bench(
    "SlidingWindowLog (100 per 1s)",
    setup(new SlidingWindowLog({ limit: 100, windowMs: 1000 })),
  );
  bench(
    "SlidingWindowCounter (100 per 1s)",
    setup(new SlidingWindowCounter({ limit: 100, windowMs: 1000 })),
  );
});
