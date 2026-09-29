import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/index.js";
import { fakeClock } from "./helpers.js";

describe("MemoryStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips state through update/get and returns the callback result", async () => {
    const store = new MemoryStore({ clock: fakeClock() });
    const result = await store.update<number, string>("k", (current) => ({
      state: (current ?? 0) + 1,
      ttlMs: 1000,
      result: `was ${String(current)}`,
    }));
    expect(result).toBe("was undefined");
    await expect(store.get<number>("k")).resolves.toBe(1);
    await store.update<number, null>("k", (current) => ({
      state: (current ?? 0) + 1,
      ttlMs: 1000,
      result: null,
    }));
    await expect(store.get<number>("k")).resolves.toBe(2);
  });

  it("evicts entries lazily once their TTL has elapsed", async () => {
    const clock = fakeClock(0);
    const store = new MemoryStore({ clock });
    await store.update("k", () => ({ state: "v", ttlMs: 500, result: null }));
    clock.advance(499);
    await expect(store.get("k")).resolves.toBe("v");
    clock.advance(1);
    await expect(store.get("k")).resolves.toBeUndefined();
    expect(store.size).toBe(0);
    // An update after expiry sees a fresh key.
    await store.update<string, null>("k", (current) => {
      expect(current).toBeUndefined();
      return { state: "again", ttlMs: 1, result: null };
    });
  });

  it("sweeps expired entries in bulk", async () => {
    const clock = fakeClock(0);
    const store = new MemoryStore({ clock });
    await store.update("a", () => ({ state: 1, ttlMs: 10, result: null }));
    await store.update("b", () => ({ state: 1, ttlMs: 20, result: null }));
    await store.update("c", () => ({ state: 1, ttlMs: 30, result: null }));
    clock.advance(20);
    expect(store.sweep()).toBe(2);
    expect(store.size).toBe(1);
    await expect(store.get("c")).resolves.toBe(1);
  });

  it("bounds the number of keys with LRU eviction", async () => {
    const store = new MemoryStore({ clock: fakeClock(), maxKeys: 3 });
    for (const k of ["a", "b", "c"]) {
      await store.update(k, () => ({ state: k, ttlMs: 1000, result: null }));
    }
    // Touch "a" so "b" becomes the least recently used.
    await store.get("a");
    await store.update("d", () => ({ state: "d", ttlMs: 1000, result: null }));
    expect(store.size).toBe(3);
    await expect(store.get("b")).resolves.toBeUndefined();
    await expect(store.get("a")).resolves.toBe("a");
    await expect(store.get("c")).resolves.toBe("c");
    await expect(store.get("d")).resolves.toBe("d");
  });

  it("deletes and clears", async () => {
    const store = new MemoryStore({ clock: fakeClock() });
    await store.update("a", () => ({ state: 1, ttlMs: 1000, result: null }));
    await store.update("b", () => ({ state: 1, ttlMs: 1000, result: null }));
    await store.delete("a");
    await expect(store.get("a")).resolves.toBeUndefined();
    store.clear();
    expect(store.size).toBe(0);
  });

  it("runs a background sweeper when asked and can be disposed", async () => {
    vi.useFakeTimers();
    const clock = fakeClock(0);
    const store = new MemoryStore({ clock, sweepIntervalMs: 100 });
    await store.update("a", () => ({ state: 1, ttlMs: 50, result: null }));
    clock.advance(60);
    vi.advanceTimersByTime(100);
    expect(store.size).toBe(0);
    store.dispose();
    store.dispose(); // idempotent
    await store.update("b", () => ({ state: 1, ttlMs: 50, result: null }));
    clock.advance(60);
    vi.advanceTimersByTime(1000);
    expect(store.size).toBe(1);
  });

  it("rejects a non-positive maxKeys", () => {
    expect(() => new MemoryStore({ maxKeys: 0 })).toThrow(RangeError);
  });

  it("uses the system clock by default", async () => {
    const store = new MemoryStore();
    await store.update("k", () => ({ state: 1, ttlMs: 60_000, result: null }));
    await expect(store.get("k")).resolves.toBe(1);
  });
});
