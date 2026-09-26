import { Server } from 'socket.io';

let io: Server | null = null;

/**
 * Rooms we already warned about having zero subscribers. Cleared whenever a
 * socket joins the room again, so a later broadcast can warn once more.
 */
const emptyRoomsWarned = new Set<string>();

function roomSize(room: string): number {
  return io?.sockets.adapter.rooms.get(room)?.size ?? 0;
}

export const WebSocketService = {
  /**
   * Initialize Socket.IO using Bun upgrade events.
   */
  initialize(ioInstance: Server) {
    io = ioInstance;

    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      socket.on('subscribe_project', (projectId: string) => {
        socket.join(`project:${projectId}`);
      });

      socket.on('subscribe_build', (buildId: string) => {
        const room = `build:${buildId}`;
        socket.join(room);
        // A fresh join resets the empty-room warning so it can warn again later.
        emptyRoomsWarned.delete(room);
        console.log(`[WS] Socket ${socket.id} joined ${room} (subscribers: ${roomSize(room)})`);
      });

      socket.on('unsubscribe_build', (buildId: string) => {
        const room = `build:${buildId}`;
        socket.leave(room);
        console.log(`[WS] Socket ${socket.id} left ${room} (subscribers: ${roomSize(room)})`);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });
  },

  /**
   * Broadcast a build log line to everyone subscribed to the build room.
   *
   * `meta` carries the persisted row id + timestamp so clients can de-duplicate
   * when they backfill lines missed over a flaky transport. Warns (once per join
   * cycle) when there are no subscribers so pm2 logs show whether live logs are
   * even reachable.
   */
  broadcast(
    buildId: string,
    message: string,
    level: string = 'info',
    meta: { id?: string; timestamp?: string } = {},
  ) {
    const room = `build:${buildId}`;
    const subscribers = roomSize(room);

    if (subscribers === 0) {
      if (!emptyRoomsWarned.has(room)) {
        emptyRoomsWarned.add(room);
        console.warn(
          `[WS] broadcast -> ${room} has 0 subscribers; logs are persisted but not streamed live`,
        );
      }
    } else if (emptyRoomsWarned.has(room)) {
      emptyRoomsWarned.delete(room);
      console.log(`[WS] ${room} subscribers: ${subscribers}`);
    }

    io?.to(room).emit('build_log', {
      buildId,
      data: message,
      level,
      ...meta,
    });
  },

  broadcastBuildUpdate(projectId: string, payload: any) {
    io?.to(`project:${projectId}`).emit('build_updated', payload);
  },

  broadcastDeploymentUpdate(projectId: string, payload: any) {
    io?.to(`project:${projectId}`).emit('deployment_updated', payload);
  },

  broadcastDomainStatus(projectId: string, payload: any) {
    io?.to(`project:${projectId}`).emit('domain_status', payload);
  },
};
