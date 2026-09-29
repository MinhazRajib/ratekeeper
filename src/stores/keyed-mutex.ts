/**
 * Serializes async work per key inside one process. Each key owns a promise
 * chain; a new task waits for the previous one on the same key to settle, so
 * read-modify-write sequences never interleave. Chains are removed once idle
 * to keep memory proportional to in-flight keys only.
 */
export class KeyedMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  /** Number of keys with in-flight work. */
  get size(): number {
    return this.chains.size;
  }

  run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    // Run after the previous task settles, regardless of whether it failed.
    const next = previous.then(task, task);
    // Track a settled-safe handle so a rejection in `task` never becomes unhandled here.
    const tracked = next.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(key, tracked);
    void tracked.then(() => {
      if (this.chains.get(key) === tracked) this.chains.delete(key);
    });
    return next;
  }
}
