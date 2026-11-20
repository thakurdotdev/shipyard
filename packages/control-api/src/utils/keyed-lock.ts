/**
 * Runs critical sections for the same key one at a time, in the order they asked.
 * In-process only, which is enough while the control API runs as a single process.
 *
 * `maxHoldMs` bounds how long one holder can block the next, so a hung request
 * (a stuck network call, say) delays later work instead of stopping it for good.
 */
export function createKeyedLock(maxHoldMs: number) {
  const tails = new Map<string, Promise<void>>();

  return {
    /** Resolves once every earlier holder of `key` released (or timed out). Call the result to release. */
    async acquire(key: string): Promise<() => void> {
      const previous = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      // A holder counts as released when it calls release() or after maxHoldMs.
      const done = Promise.race([held, delay(maxHoldMs)]);
      const tail = previous.then(() => done);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });

      await previous;
      return release;
    },

    /** Number of keys with a holder or waiters (for tests). */
    get size() {
      return tails.size;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Never keep the process alive just for a lock timeout.
    (timer as { unref?: () => void }).unref?.();
  });
}
