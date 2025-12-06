import { useEffect, useState, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { io } from "socket.io-client";
import Ansi from "ansi-to-react";

export function LogViewer({
  buildId,
  initialLogs,
}: {
  buildId: string;
  initialLogs: string;
}) {
  const [logs, setLogs] = useState(initialLogs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = io(
      process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4003",
    );

    socket.on("connect", () => {
      console.log("Socket Connected");
      socket.emit("subscribe_build", buildId);
    });

    socket.on("build_log", (message) => {
      if (message.buildId === buildId) {
        setLogs((prev) => prev + message.data);
      }
    });

    socket.on("disconnect", () => {
      console.log("Socket Disconnected");
    });

    return () => {
      socket.emit("unsubscribe_build", buildId);
      socket.disconnect();
    };
  }, [buildId]);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (viewportRef.current) {
      const scrollableNode = viewportRef.current.children[1] as HTMLElement;
      if (scrollableNode) {
        scrollableNode.scrollTop = scrollableNode.scrollHeight;
      }
    }
  }, [logs]);

  return (
    <ScrollArea
      ref={viewportRef}
      className="h-[500px] w-full rounded-md border bg-zinc-950 p-4"
    >
      <div className="font-mono text-xs sm:text-sm text-zinc-100 whitespace-pre-wrap font-ligatures-none">
        <Ansi>{logs}</Ansi>
      </div>
    </ScrollArea>
  );
}
