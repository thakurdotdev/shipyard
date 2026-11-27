/**
 * Runs tasks for one key strictly one after another, in the order they were started, while
 * tasks for different keys run in parallel.
 *
 * With more than one build at a time, two pushes to the same project could otherwise build
 * side by side, and if the older commit finished last it would go live over the newer one.
 * Queued builds of a project are already superseded by newer ones in the Control API; this
 * covers the build that had already started.
 */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();

  return async function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
