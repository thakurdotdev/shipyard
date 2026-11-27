import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { groupByLevel, LogStreamer } from './log-streamer';

describe('groupByLevel', () => {
  it('joins neighbouring lines of one level without reordering', () => {
    expect(
      groupByLevel([
        { message: 'a\n', level: 'info' },
        { message: 'b\n', level: 'info' },
        { message: 'boom\n', level: 'error' },
        { message: 'c\n', level: 'info' },
      ]),
    ).toEqual([
      { message: 'a\nb\n', level: 'info' },
      { message: 'boom\n', level: 'error' },
      { message: 'c\n', level: 'info' },
    ]);
  });
});

describe('LogStreamer', () => {
  afterEach(() => mock.restore());

  it('delivers batches in order and forgets the build once idle', async () => {
    const sent: string[] = [];
    let release!: () => void;
    const firstGate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    spyOn(globalThis, 'fetch').mockImplementation((async (_url: unknown, init?: RequestInit) => {
      const { logs } = JSON.parse(String(init?.body));
      // Hold the first request so the second flush has to wait behind it.
      if (calls++ === 0) await firstGate;
      sent.push(logs);
      return new Response('{}');
    }) as typeof fetch);

    LogStreamer.stream('b-order', 'p', 'one\n');
    const first = LogStreamer.flush('b-order');
    LogStreamer.stream('b-order', 'p', 'two\n');
    const second = LogStreamer.flush('b-order');
    release();
    await Promise.all([first, second]);
    await LogStreamer.ensureFlushed('b-order');
    await Bun.sleep(0);

    expect(sent).toEqual(['one\n', 'two\n']);
    expect(LogStreamer.pending).toBe(0);
  });

  it('keeps going when the Control API is unreachable', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    spyOn(globalThis, 'fetch').mockImplementation((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    LogStreamer.stream('b-down', 'p', 'line\n');
    await LogStreamer.ensureFlushed('b-down');
    await Bun.sleep(0);
    expect(LogStreamer.pending).toBe(0);
  });
});
