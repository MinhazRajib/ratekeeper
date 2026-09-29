import { CAS_SCRIPT, type RedisLikeClient } from "../src/index.js";

/** A controllable clock: `clock()` reads it, `clock.advance(ms)` / `clock.set(ms)` move it. */
export interface FakeClock {
  (): number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function fakeClock(start = 0): FakeClock {
  let now = start;
  const clock = (() => now) as FakeClock;
  clock.advance = (ms) => {
    now += ms;
  };
  clock.set = (ms) => {
    now = ms;
  };
  return clock;
}

/**
 * Minimal in-memory stand-in for a Redis client. It understands exactly the
 * compare-and-set script `RedisStore` sends, honours PX expiry via the fake
 * clock, and exposes hooks to simulate another process racing us.
 */
export class FakeRedis implements RedisLikeClient {
  readonly data = new Map<string, { value: string; expiresAt: number }>();
  readonly calls: string[] = [];
  /** Runs after every GET; use it to mutate the store as if another process wrote. */
  afterGet: ((key: string) => void) | undefined;

  constructor(private readonly clock: () => number) {}

  get(key: string): Promise<string | null> {
    this.calls.push("get");
    const value = this.read(key);
    this.afterGet?.(key);
    return Promise.resolve(value);
  }

  set(key: string, value: string, _mode: "PX", ttlMs: number): Promise<"OK"> {
    this.calls.push("set");
    this.data.set(key, { value, expiresAt: this.clock() + ttlMs });
    return Promise.resolve("OK");
  }

  del(key: string): Promise<number> {
    this.calls.push("del");
    return Promise.resolve(this.data.delete(key) ? 1 : 0);
  }

  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    this.calls.push("eval");
    if (script !== CAS_SCRIPT || numKeys !== 1) {
      return Promise.reject(new Error("FakeRedis: unsupported script"));
    }
    const [key, expected, next, ttl] = args as [string, string, string, string];
    const current = this.read(key) ?? "";
    if (current !== expected) return Promise.resolve(0);
    const ttlMs = Number(ttl);
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      return Promise.reject(new Error("ERR invalid expire time in 'set' command"));
    }
    this.data.set(key, { value: next, expiresAt: this.clock() + ttlMs });
    return Promise.resolve(1);
  }

  private read(key: string): string | null {
    const entry = this.data.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.clock()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }
}
