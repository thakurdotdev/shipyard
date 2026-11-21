'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Download, Loader2, Pause, Play, RotateCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { pm0Api } from '@/lib/pm0-api';
import { cn } from '@/lib/utils';

interface LogLine {
  /** Increasing per viewer, so React keys survive trimming the backlog. */
  seq: number;
  stream: 'stdout' | 'stderr';
  data: string;
}

const MAX_LINES = 2000;

interface ProcessLogViewerProps {
  target: string;
  processName: string;
  onClose?: () => void;
  /** Height of the scrolling area; defaults to a fixed 360px. */
  className?: string;
}

/**
 * Live stdout/stderr for one PM0 process. Follows new output while scrolled to
 * the bottom; scrolling up, or pausing, holds the view and buffers new lines.
 */
export function ProcessLogViewer({
  target,
  processName,
  onClose,
  className,
}: ProcessLogViewerProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [buffered, setBuffered] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [streamKey, setStreamKey] = useState(0);
  const [filter, setFilter] = useState('');
  const [stderrOnly, setStderrOnly] = useState(false);
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const seq = useRef(0);
  pausedRef.current = paused;

  useEffect(() => {
    setLines([]);
    setBuffered([]);
    const es = new EventSource(
      pm0Api.getLogsUrl(target, { lines: 200, follow: true, stderr: true }),
      {
        withCredentials: true,
      },
    );
    // Batch bursts (the 200-line backlog arrives at once) into one render. A timer,
    // not requestAnimationFrame, so hidden tabs still keep up.
    let pending: LogLine[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      const append = (prev: LogLine[]) => {
        const next = prev.concat(batch);
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      };
      if (pausedRef.current) setBuffered(append);
      else setLines(append);
    };
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (event) => {
      try {
        const line = JSON.parse(event.data) as { stream: LogLine['stream']; data: string };
        pending.push({ seq: seq.current++, stream: line.stream, data: line.data });
        if (!frame) frame = window.setTimeout(flush, 50);
      } catch {
        // Ignore keep-alives and malformed messages.
      }
    };
    return () => {
      if (frame) window.clearTimeout(frame);
      es.close();
      setConnected(false);
    };
  }, [target, streamKey]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return lines.filter(
      (line) =>
        (!stderrOnly || line.stream === 'stderr') &&
        (!needle || line.data.toLowerCase().includes(needle)),
    );
  }, [lines, filter, stderrOnly]);

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Follow output without ever scrolling the page around the viewer.
  useLayoutEffect(() => {
    if (following) scrollToEnd();
  }, [visible, following, scrollToEnd]);

  const resume = () => {
    setLines((prev) => prev.concat(buffered).slice(-MAX_LINES));
    setBuffered([]);
    setPaused(false);
    setFollowing(true);
  };

  const download = () => {
    const text = lines.map((line) => `[${line.stream}] ${line.data}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${processName}-logs.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = async () => {
    setClearing(true);
    try {
      const result = await pm0Api.clearLogs(target);
      setStreamKey((key) => key + 1);
      toast.success(
        `Cleared ${result.cleared_files} log file${result.cleared_files === 1 ? '' : 's'}`,
      );
    } catch (err) {
      toast.error('Could not clear logs', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setClearing(false);
    }
  };

  const toolButton =
    'inline-grid size-7 cursor-pointer place-items-center rounded-md text-console-muted outline-none transition-colors hover:bg-console-surface hover:text-console-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  return (
    <div className="flex min-h-0 flex-col overflow-hidden bg-console text-console-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-console-border px-3 py-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs',
            connected ? 'text-emerald-400' : 'text-console-muted',
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              connected ? 'bg-emerald-400' : 'bg-console-muted',
            )}
          />
          {paused ? 'Paused' : connected ? 'Live' : 'Disconnected'}
        </span>
        {!connected && (
          <button
            type="button"
            onClick={() => setStreamKey((key) => key + 1)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-console-muted hover:text-console-foreground"
          >
            <RotateCw className="size-3" /> Reconnect
          </button>
        )}

        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter output"
          aria-label="Filter log output"
          spellCheck={false}
          className="ml-auto h-7 w-36 min-w-0 rounded-md border border-console-border bg-console-surface px-2 font-mono text-xs text-console-foreground outline-none placeholder:text-console-muted focus:border-white/25 sm:w-48"
        />
        <button
          type="button"
          aria-pressed={stderrOnly}
          onClick={() => setStderrOnly((value) => !value)}
          className={cn(
            'h-7 cursor-pointer rounded-md border px-2 font-mono text-xs transition-colors',
            stderrOnly
              ? 'border-red-400/40 bg-red-400/10 text-red-300'
              : 'border-console-border text-console-muted hover:text-console-foreground',
          )}
        >
          stderr
        </button>

        <div className="flex items-center">
          <button
            type="button"
            className={toolButton}
            onClick={() => (paused ? resume() : setPaused(true))}
            title={paused ? 'Resume' : 'Pause'}
            aria-label={paused ? 'Resume log stream' : 'Pause log stream'}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </button>
          <button
            type="button"
            className={toolButton}
            onClick={download}
            title="Download"
            aria-label="Download logs"
            disabled={lines.length === 0}
          >
            <Download className="size-3.5" />
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className={toolButton}
                disabled={clearing}
                title="Clear log files"
                aria-label="Clear log files"
              >
                {clearing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear logs for {processName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently empties its stdout and stderr files, including rotated copies.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={clearLogs}
                >
                  Clear logs
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {onClose && (
            <button
              type="button"
              className={toolButton}
              onClick={onClose}
              title="Close"
              aria-label="Close logs"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
          className={cn(
            'overflow-auto overscroll-contain py-3 font-mono text-[12.5px] leading-[1.65]',
            className ?? 'h-[360px]',
          )}
          role="log"
          aria-live="off"
          aria-label={`Output of ${processName}`}
        >
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-console-muted">
              {lines.length === 0
                ? connected
                  ? 'Waiting for output…'
                  : 'Connecting…'
                : 'No lines match the filter.'}
            </p>
          ) : (
            visible.map((line) => (
              <div
                key={line.seq}
                className={cn(
                  'flex gap-3 px-4 whitespace-pre-wrap break-all hover:bg-white/[0.03]',
                  line.stream === 'stderr' && 'bg-red-500/[0.06]',
                )}
              >
                <span
                  className={cn(
                    'w-6 shrink-0 select-none text-right',
                    line.stream === 'stderr' ? 'text-red-400/80' : 'text-console-muted/60',
                  )}
                  aria-label={line.stream}
                >
                  {line.stream === 'stderr' ? 'err' : '›'}
                </span>
                <span className={line.stream === 'stderr' ? 'text-red-200' : undefined}>
                  {line.data}
                </span>
              </div>
            ))
          )}
        </div>

        {(paused || !following) && (
          <button
            type="button"
            onClick={() => (paused ? resume() : (setFollowing(true), scrollToEnd()))}
            className="absolute right-4 bottom-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-console-border bg-console-surface px-3 py-1 text-xs text-console-foreground shadow-lg hover:border-white/25"
          >
            <ArrowDown className="size-3" />
            {paused
              ? `Resume${buffered.length ? ` · ${buffered.length} new` : ''}`
              : 'Jump to latest'}
          </button>
        )}
      </div>
    </div>
  );
}
