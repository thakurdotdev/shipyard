'use client';

import { useEffect, useRef, useState, UIEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import Ansi from 'ansi-to-react';
import { useLogStore } from '@/stores/log-store';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Copy, Download, Loader2, ArrowDownCircle, PauseCircle, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface LogViewerProps {
  buildId: string;
}

export function LogViewer({ buildId }: LogViewerProps) {
  const { logs, appendLog, setLogs } = useLogStore();
  const logContent = logs[buildId] || '';
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const socketRef = useRef<Socket | null>(null);

  // Fetch initial logs if empty
  useEffect(() => {
    let mounted = true;

    const fetchLogs = async () => {
      try {
        if (!logContent) {
          const existingLogs = await api.getBuildLogs(buildId);
          if (mounted && existingLogs) {
            setLogs(buildId, existingLogs);
          }
        }
      } catch (error) {
        console.error('Failed to fetch logs', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    fetchLogs();

    return () => {
      mounted = false;
    };
  }, [buildId, setLogs]); // Removed logContent from deps to avoid refetch loops if logs exist but stale?
  // Actually logContent check protects it.

  // Socket connection
  useEffect(() => {
    socketRef.current = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
    const socket = socketRef.current;

    socket.on('connect', () => {
      socket.emit('subscribe_build', buildId);
    });

    socket.on('build_log', (message: any) => {
      if (message.buildId === buildId) {
        appendLog(buildId, message.data);
      }
    });

    return () => {
      socket.emit('unsubscribe_build', buildId);
      socket.disconnect();
    };
  }, [buildId, appendLog]);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      const scrollContainer = scrollRef.current;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [logContent, autoScroll]);

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = Math.abs(target.scrollHeight - target.scrollTop - target.clientHeight) < 20; // 20px threshold
    setIsScrolledToBottom(isAtBottom);

    if (autoScroll && !isAtBottom) {
      // User scrolled up, disable auto-scroll temporarily?
      // Or just let the user toggle it.
      // Common pattern: if user scrolls up, pause auto-scroll.
      setAutoScroll(false);
    } else if (!autoScroll && isAtBottom) {
      // User scrolled to bottom, re-enable auto-scroll?
      setAutoScroll(true);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(logContent);
    toast.success('Logs copied to clipboard');
  };

  const handleDownload = () => {
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `build-${buildId}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c0c] text-white overflow-hidden border border-white/10 shadow-2xl relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/5 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Build Logs
          </span>
          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7 text-muted-foreground hover:text-foreground',
              autoScroll && 'text-primary',
            )}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
          >
            {autoScroll ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
          </Button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
            title="Copy all"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleDownload}
            title="Download logs"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Native Scroll Container */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap font-ligatures-none scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30"
        onScroll={handleScroll}
      >
        {logContent ? (
          <Ansi>{logContent}</Ansi>
        ) : (
          <div className="text-muted-foreground/50 italic">Waiting for logs...</div>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {!autoScroll && !isScrolledToBottom && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-4 right-4 shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 animate-in fade-in zoom-in duration-200"
          onClick={() => setAutoScroll(true)}
        >
          <ArrowDownCircle className="w-4 h-4 mr-2" />
          Scroll to Bottom
        </Button>
      )}
    </div>
  );
}
