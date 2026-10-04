'use client';

import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { X, Pause, Play, Download, Trash2 } from 'lucide-react';
import { pm0Api } from '@/lib/pm0-api';

interface LogLine {
  pm_id: number;
  name: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

interface ProcessLogViewerProps {
  target: string;
  processName: string;
  onClose: () => void;
}

export function ProcessLogViewer({ target, processName, onClose }: ProcessLogViewerProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const url = pm0Api.getLogsUrl(target, { lines: 200, follow: true, stderr: true });
    const es = new EventSource(url, { withCredentials: true });

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const line: LogLine = JSON.parse(e.data);
        if (!pausedRef.current) {
          setLines((prev) => {
            const next = [...prev, line];
            // Keep last 2000 lines to prevent memory issues
            return next.length > 2000 ? next.slice(-2000) : next;
          });
        }
      } catch {
        // Ignore malformed or non-JSON SSE messages
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    eventSourceRef.current = es;

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [target]);

  // Auto-scroll
  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, paused]);

  const downloadLogs = () => {
    const text = lines.map((l) => `[${l.stream}] ${l.data}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${processName}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-console-border bg-console">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-console-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-medium text-console-foreground">
            {processName}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-400' : 'text-console-muted'}`}
          >
            <span
              className={`inline-block size-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-console-muted'}`}
            />
            {connected ? 'Live' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-console-muted hover:text-console-foreground hover:bg-console-surface"
            onClick={() => setPaused(!paused)}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-console-muted hover:text-console-foreground hover:bg-console-surface"
            onClick={() => setLines([])}
            title="Clear"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-console-muted hover:text-console-foreground hover:bg-console-surface"
            onClick={downloadLogs}
            title="Download"
          >
            <Download className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-console-muted hover:text-console-foreground hover:bg-console-surface"
            onClick={onClose}
            title="Close"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Log content */}
      <ScrollArea className="h-[360px]">
        <div className="p-4 font-mono text-[13px] leading-[1.6]">
          {lines.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-console-muted">
              Waiting for log output…
            </div>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="group flex gap-2 hover:bg-console-surface/50">
                <span className="shrink-0 select-none tabular-nums text-console-muted opacity-50 group-hover:opacity-100">
                  {String(i + 1).padStart(4)}
                </span>
                {line.stream === 'stderr' && (
                  <span className="shrink-0 select-none text-red-400/80">err</span>
                )}
                <span
                  className={
                    line.stream === 'stderr' ? 'text-red-300/90' : 'text-console-foreground'
                  }
                >
                  {line.data}
                </span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Paused indicator */}
      {paused && (
        <div className="border-t border-console-border bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-300">
          Paused — new lines are buffered
        </div>
      )}
    </div>
  );
}
