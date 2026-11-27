type Listener = (chunk: string) => void;

function formatSSE(event: string, data: any): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json}\n\n`;
}

const encoder = new TextEncoder();
const PING = encoder.encode(': ping\n\n');

/** Adds `listener` to the room `key`, creating it; returns a function that removes it again. */
function join(rooms: Map<string, Set<Listener>>, key: string, listener: Listener): () => void {
  let set = rooms.get(key);
  if (!set) {
    set = new Set();
    rooms.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = rooms.get(key);
    if (!current) return;
    current.delete(listener);
    // Empty rooms are dropped so the maps only hold builds/projects someone is watching.
    if (current.size === 0) rooms.delete(key);
  };
}

function deliver(listeners: Set<Listener> | undefined, event: string, payload: unknown) {
  if (!listeners || listeners.size === 0) return;
  const message = formatSSE(event, payload);
  for (const listener of listeners) {
    try {
      listener(message);
    } catch (err) {
      console.error(`[SSE] Failed to deliver ${event} to listener:`, err);
    }
  }
}

class EventStreamServiceClass {
  private buildListeners = new Map<string, Set<Listener>>();
  private projectListeners = new Map<string, Set<Listener>>();

  /**
   * Helper to create a standard SSE Response for a given subscriber callback.
   * The subscription is released when the client goes away or the stream errors,
   * whichever happens first.
   */
  createSSEResponse(subscribe: (send: (chunk: string) => void) => () => void): Response {
    let release: (() => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        let pingInterval: ReturnType<typeof setInterval> | null = null;
        let unsubscribe: (() => void) | null = null;
        release = () => {
          if (pingInterval) clearInterval(pingInterval);
          pingInterval = null;
          unsubscribe?.();
          unsubscribe = null;
        };

        const write = (bytes: Uint8Array) => {
          try {
            controller.enqueue(bytes);
          } catch {
            // The stream closed without cancel() being called: stop holding the listener.
            release?.();
          }
        };

        // Initial comment so client knows the SSE stream is connected
        write(encoder.encode(': connected\n\n'));
        unsubscribe = subscribe((chunk) => write(encoder.encode(chunk)));
        // Keepalive heartbeat ping every 15s to keep proxy/Cloudflare connections alive
        pingInterval = setInterval(() => write(PING), 15000);
      },
      cancel() {
        release?.();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Critical for Nginx
      },
    });
  }

  /**
   * Subscribe to live logs for a specific build via SSE
   */
  subscribeBuild(buildId: string): Response {
    return this.createSSEResponse((send) => join(this.buildListeners, buildId, send));
  }

  /**
   * Subscribe to project status events (build updates, deployment updates, domain status) via SSE
   */
  subscribeProject(projectId: string): Response {
    return this.createSSEResponse((send) => join(this.projectListeners, projectId, send));
  }

  /**
   * Broadcast a build log line to all SSE subscribers of the build room.
   * Logs are persisted before this is called, so a build nobody is watching is normal.
   */
  broadcast(
    buildId: string,
    message: string,
    level: string = 'info',
    meta: { id?: string; timestamp?: string } = {},
  ) {
    deliver(this.buildListeners.get(buildId), 'build_log', {
      buildId,
      data: message,
      level,
      ...meta,
    });
  }

  broadcastBuildUpdate(projectId: string, payload: any) {
    deliver(this.projectListeners.get(projectId), 'build_updated', payload);
  }

  broadcastDeploymentUpdate(projectId: string, payload: any) {
    deliver(this.projectListeners.get(projectId), 'deployment_updated', payload);
  }

  broadcastDomainStatus(projectId: string, payload: any) {
    deliver(this.projectListeners.get(projectId), 'domain_status', payload);
  }

  broadcastUptimeStatus(projectId: string, payload: any) {
    deliver(this.projectListeners.get(projectId), 'uptime_updated', payload);
  }

  /** Open rooms (for tests and diagnostics). */
  get roomCount() {
    return this.buildListeners.size + this.projectListeners.size;
  }
}

export const EventStreamService = new EventStreamServiceClass();
