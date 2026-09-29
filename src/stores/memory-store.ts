import { type Clock, type Store, type UpdateOutcome, systemClock } from "../types.js";
import { KeyedMutex } from "./keyed-mutex.js";

export interface MemoryStoreOptions {
  /**
   * Upper bound on stored keys. When exceeded, the least recently used key is
   * evicted. Defaults to `10_000`. Use `Infinity` to disable.
   */
  readonly maxKeys?: number;
  /**
   * If set, expired entries are swept on this interval (the timer is `unref`'d
   * so it never keeps a process alive). Expired entries are always dropped
   * lazily on access regardless of this setting.
   */
  readonly sweepIntervalMs?: number;
  readonly clock?: Clock;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * In-process store. Correct under concurrent async calls because every
 * `update` for a given key runs through a `KeyedMutex`, so the callback always
 * observes the state written by the previous call.
 *
 * The map doubles as an LRU: `Map` preserves insertion order, so touching a
 * key (delete + re-insert) moves it to the back and the front is the coldest.
 */
export class MemoryStore implements Store {
  private readonly entries = new Map<string, Entry>();
  private readonly mutex = new KeyedMutex();
  private readonly maxKeys: number;
  private readonly clock: Clock;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: MemoryStoreOptions = {}) {
    this.maxKeys = options.maxKeys ?? 10_000;
    this.clock = options.clock ?? systemClock;
    if (options.maxKeys !== undefined && options.maxKeys < 1) {
      throw new RangeError("MemoryStore: maxKeys must be >= 1");
    }
    if (options.sweepIntervalMs !== undefined) {
      this.timer = setInterval(() => {
        this.sweep();
      }, options.sweepIntervalMs);
      // Edge runtimes return a number here; only Node timers have `unref`.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  /** Number of live (non-swept) entries, including ones that may have expired but not been touched. */
  get size(): number {
    return this.entries.size;
  }

  get<S>(key: string): Promise<S | undefined> {
    return Promise.resolve(this.read(key) as S | undefined);
  }

  update<S, R>(key: string, fn: (current: S | undefined) => UpdateOutcome<S, R>): Promise<R> {
    return this.mutex.run(key, () => {
      const outcome = fn(this.read(key) as S | undefined);
      this.write(key, outcome.state, outcome.ttlMs);
      return outcome.result;
    });
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  /** Drop every expired entry now. Returns the number removed. */
  sweep(): number {
    const now = this.clock();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Remove all entries. */
  clear(): void {
    this.entries.clear();
  }

  /** Stop the background sweeper, if one was started. */
  dispose(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private read(key: string): unknown {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    // Touch: move to the back of the insertion order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  private write(key: string, value: unknown, ttlMs: number): void {
    const expiresAt = this.clock() + Math.max(0, ttlMs);
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt });
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}
