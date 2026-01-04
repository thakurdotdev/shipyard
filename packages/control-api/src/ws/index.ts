import { Server } from 'socket.io';

let io: Server | null = null;

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
        socket.join(`build:${buildId}`);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });
  },

  broadcast(buildId: string, message: string, level: string = 'info') {
    io?.to(`build:${buildId}`).emit('build_log', {
      buildId,
      data: message,
      level,
    });
  },

  broadcastBuildUpdate(projectId: string, payload: any) {
    io?.to(`project:${projectId}`).emit('build_updated', payload);
  },

  broadcastDeploymentUpdate(projectId: string, payload: any) {
    io?.to(`project:${projectId}`).emit('deployment_updated', payload);
  },
};
