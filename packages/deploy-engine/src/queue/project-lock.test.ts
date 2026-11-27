import { describe, expect, it } from 'bun:test';
import { createKeyedLock } from './project-lock';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createKeyedLock', () => {
  it('runs tasks for one project in the order they started', async () => {
    const run = createKeyedLock();
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await tick(ms);
      events.push(`end ${name}`);
      return name;
    };
    // The older build is slower; it must still finish before the newer one starts.
    const results = await Promise.all([run('p1', task('old', 30)), run('p1', task('new', 1))]);
    expect(results).toEqual(['old', 'new']);
    expect(events).toEqual(['start old', 'end old', 'start new', 'end new']);
  });

  it('lets different projects run at the same time', async () => {
    const run = createKeyedLock();
    const events: string[] = [];
    await Promise.all([
      run('a', async () => {
        events.push('start a');
        await tick(20);
        events.push('end a');
      }),
      run('b', async () => {
        events.push('start b');
        await tick(1);
        events.push('end b');
      }),
    ]);
    expect(events.slice(0, 2).sort()).toEqual(['start a', 'start b']);
    expect(events.indexOf('end b')).toBeLessThan(events.indexOf('end a'));
  });

  it('keeps going after a failed task', async () => {
    const run = createKeyedLock();
    const failed = run('p', async () => {
      throw new Error('build failed');
    });
    const next = run('p', async () => 'next build');
    await expect(failed).rejects.toThrow('build failed');
    expect(await next).toBe('next build');
  });
});
