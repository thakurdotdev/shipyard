import { describe, expect, it } from 'bun:test';
import { createKeyedLock } from './keyed-lock';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('createKeyedLock', () => {
  it('runs holders of one key in the order they asked', async () => {
    const lock = createKeyedLock(10_000);
    const order: string[] = [];

    const run = async (name: string, ms: number) => {
      const release = await lock.acquire('repo:main');
      order.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(`end ${name}`);
      release();
    };

    // The first holder is the slowest; the others must still wait their turn.
    await Promise.all([run('first', 30), run('second', 1), run('third', 1)]);
    expect(order).toEqual([
      'start first',
      'end first',
      'start second',
      'end second',
      'start third',
      'end third',
    ]);
    await tick();
    expect(lock.size).toBe(0);
  });

  it('does not block other keys', async () => {
    const lock = createKeyedLock(10_000);
    const releaseA = await lock.acquire('a');
    const releaseB = await Promise.race([lock.acquire('b'), tick().then(() => null)]);
    expect(releaseB).not.toBeNull();
    releaseA();
    releaseB?.();
  });

  it('lets the next holder in after maxHoldMs if a holder never releases', async () => {
    const lock = createKeyedLock(20);
    await lock.acquire('k'); // never released
    const started = Date.now();
    const release = await lock.acquire('k');
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    release();
  });
});
