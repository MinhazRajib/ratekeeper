# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-28

### Added

- `RateLimiter` with `check`, `peek` and `reset`, an injectable clock and key prefixing.
- Four algorithms behind one pure `Algorithm` interface: `TokenBucket`, `FixedWindow`,
  `SlidingWindowLog` and `SlidingWindowCounter`.
- `MemoryStore` with lazy TTL eviction, optional background sweeping and an LRU key bound.
- `RedisStore` for any `get`/`set`/`del`/`eval` client, using a compare-and-set Lua script.
- `expressRateLimit` middleware and `fetchRateLimit` handler wrapper that emit
  `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `Retry-After`.
- `keyed()` helper for per-route limits sharing one store.
- ESM and CommonJS builds with type declarations.

[0.1.0]: https://github.com/MinhazRajib/ratekeeper/releases/tag/v0.1.0
