import { Server } from "socket.io";

let io: Server | null = null;

export const WebSocketService = {
  initialize() {
    io = new Server({
      cors: {
        origin: "*", // Allow all origins for now
        methods: ["GET", "POST"],
      },
    });

    io.listen(4003);

    io.on("connection", (socket) => {
      console.log("Client connected:", socket.id);

      socket.on("subscribe_project", (projectId: string) => {
        socket.join(`project:${projectId}`);
        console.log(`Client ${socket.id} subscribed to project ${projectId}`);
      });

      socket.on("unsubscribe_project", (projectId: string) => {
        socket.leave(`project:${projectId}`);
        console.log(
          `Client ${socket.id} unsubscribed from project ${projectId}`,
        );
      });

      socket.on("subscribe_build", (buildId: string) => {
        socket.join(`build:${buildId}`);
        console.log(`Client ${socket.id} subscribed to build ${buildId}`);
      });

      socket.on("unsubscribe_build", (buildId: string) => {
        socket.leave(`build:${buildId}`);
        console.log(`Client ${socket.id} unsubscribed from build ${buildId}`);
      });

      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
      });
    });

    console.log("Socket.IO initialized on port 4003");
  },

  broadcast(buildId: string, message: string) {
    if (io) {
      io.to(`build:${buildId}`).emit("build_log", {
        buildId,
        data: message,
      });
    }
  },

  broadcastBuildUpdate(projectId: string, build: any) {
    if (io) {
      io.to(`project:${projectId}`).emit("build_updated", build);
    }
  },
};

// Deprecated: Remove wsPlugin
export const wsPlugin = (app: any) => app;
