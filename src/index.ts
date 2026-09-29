export {
  type Algorithm,
  type Clock,
  type ConsumeOutcome,
  type RateLimitResult,
  type Store,
  type UpdateOutcome,
  systemClock,
} from "./types.js";

export { RateLimiter, type RateLimiterOptions } from "./rate-limiter.js";
export { KeyedLimiter, keyed } from "./keyed.js";

export {
  TokenBucket,
  type TokenBucketOptions,
  type TokenBucketState,
} from "./algorithms/token-bucket.js";
export {
  FixedWindow,
  type FixedWindowOptions,
  type FixedWindowState,
} from "./algorithms/fixed-window.js";
export {
  SlidingWindowLog,
  type SlidingWindowLogOptions,
  type SlidingWindowLogState,
} from "./algorithms/sliding-window-log.js";
export {
  SlidingWindowCounter,
  type SlidingWindowCounterOptions,
  type SlidingWindowCounterState,
} from "./algorithms/sliding-window-counter.js";

export { MemoryStore, type MemoryStoreOptions } from "./stores/memory-store.js";
export {
  RedisStore,
  RedisConflictError,
  CAS_SCRIPT,
  type RedisLikeClient,
  type RedisStoreOptions,
} from "./stores/redis-store.js";
export { KeyedMutex } from "./stores/keyed-mutex.js";

export {
  expressRateLimit,
  type ExpressLikeRequest,
  type ExpressLikeResponse,
  type ExpressRateLimitOptions,
  type NextFunction,
} from "./adapters/express.js";
export { fetchRateLimit, type FetchHandler, type FetchRateLimitOptions } from "./adapters/fetch.js";
export { clientIp, rateLimitHeaders, type HeaderLookup } from "./adapters/shared.js";
