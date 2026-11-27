import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { relaySSE } from './sse-relay';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = new TextDecoder();

describe('relaySSE', () => {
  afterEach(() => mock.restore());

  it('passes data through and pings while the upstream is quiet', async () => {
    let push!: (s: string) => void;
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(enc(s));
      },
    });
    const reader = relaySSE(upstream, { pingMs: 10 }).getReader();
    push('data: one\n\n');
    expect(dec.decode((await reader.read()).value)).toBe('data: one\n\n');
    // Nothing from upstream now: the relay's own keepalive arrives.
    expect(dec.decode((await reader.read()).value)).toBe(': ping\n\n');
    await reader.cancel();
  });

  it('ends quietly with one tagged line when the upstream read fails', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const upstream = new ReadableStream<Uint8Array>({
      pull() {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      },
    });
    const reader = relaySSE(upstream, { pingMs: 60_000, label: 'Test' }).getReader();
    expect((await reader.read()).done).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toStartWith('[Test] Upstream stream ended: TimeoutError');
  });

  it('closes the upstream when the browser goes away', async () => {
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await relaySSE(upstream, { pingMs: 60_000 }).cancel();
    expect(cancelled).toBe(true);
  });
});
