import { describe, expect, it } from 'bun:test';
import { EventStreamService } from './event-stream-service';

async function readUntil(
  reader: { read(): Promise<{ value?: Uint8Array; done: boolean }> },
  text: string,
) {
  const decoder = new TextDecoder();
  let seen = '';
  while (!seen.includes(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
  }
  return seen;
}

describe('EventStreamService', () => {
  it('streams build logs to subscribers and drops the room when they leave', async () => {
    const before = EventStreamService.roomCount;
    const res = EventStreamService.subscribeBuild('build-sse-1');
    const reader = res.body!.getReader();
    await readUntil(reader, ': connected');
    expect(EventStreamService.roomCount).toBe(before + 1);

    EventStreamService.broadcast('build-sse-1', 'hello\n', 'info', { id: 'l1' });
    const chunk = await readUntil(reader, 'hello');
    expect(chunk).toContain('event: build_log');
    expect(chunk).toContain('"id":"l1"');

    await reader.cancel();
    expect(EventStreamService.roomCount).toBe(before);
  });

  it('keeps nothing for builds nobody watches', () => {
    const before = EventStreamService.roomCount;
    for (let i = 0; i < 50; i++) EventStreamService.broadcast(`unwatched-${i}`, 'x');
    expect(EventStreamService.roomCount).toBe(before);
  });
});
