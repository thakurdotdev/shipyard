const PING = new TextEncoder().encode(': ping\n\n');

/**
 * Relays an upstream SSE body to the browser.
 *
 * Returning a fetch() body straight from a route has two problems: a quiet stream
 * (a process that logs nothing for a while) gets no traffic, so proxies in between
 * can drop it, and when the upstream read fails Elysia logs the bare error to stderr.
 * This relay sends its own keepalive comments and ends the stream quietly when the
 * upstream goes away, so the browser's EventSource simply reconnects.
 */
export function relaySSE(
  upstream: ReadableStream<Uint8Array>,
  { pingMs = 15_000, label = 'SSE relay' }: { pingMs?: number; label?: string } = {},
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  let ping: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stop = () => {
    closed = true;
    if (ping) clearInterval(ping);
    ping = null;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      ping = setInterval(() => {
        try {
          controller.enqueue(PING);
        } catch {
          stop();
        }
      }, pingMs);
    },
    async pull(controller) {
      if (closed) return;
      try {
        const { value, done } = await reader.read();
        if (closed) return;
        if (done) {
          stop();
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (error) {
        if (closed) return;
        stop();
        // An abort is the browser leaving; anything else is worth one tagged line.
        const name = (error as { name?: string })?.name;
        if (name !== 'AbortError') {
          console.warn(`[${label}] Upstream stream ended: ${name ?? 'Error'}: ${String(error)}`);
        }
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel(reason) {
      stop();
      return reader.cancel(reason).catch(() => {});
    },
  });
}
