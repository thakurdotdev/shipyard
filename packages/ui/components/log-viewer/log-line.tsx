'use client';

import { useMemo } from 'react';
import Ansi from 'ansi-to-react';
import { LogEntry, LogLevel } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getLogLineStyle } from './log-utils';

interface LogLineProps {
  entry: LogEntry;
  searchTerm: string;
  isCurrentMatch: boolean;
  lineRef?: React.RefObject<HTMLDivElement | null>;
}

export function LogLine({ entry, searchTerm, isCurrentMatch, lineRef }: LogLineProps) {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });

  const message = entry.message.replace(/\n$/, '');

  // Highlight search matches in message
  const highlightedMessage = useMemo(() => {
    if (!searchTerm) return <Ansi>{message}</Ansi>;

    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = message.split(new RegExp(`(${escapedTerm})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchTerm.toLowerCase() ? (
        <mark key={i} className="bg-yellow-500/50 text-white rounded px-0.5">
          {part}
        </mark>
      ) : (
        <Ansi key={i}>{part}</Ansi>
      ),
    );
  }, [message, searchTerm]);

  return (
    <div
      ref={lineRef as React.RefObject<HTMLDivElement>}
      className={cn(
        'flex font-mono text-xs leading-5 hover:bg-zinc-800/30',
        getLogLineStyle(entry.level, isCurrentMatch),
      )}
    >
      <span className="text-zinc-600 select-none shrink-0 pr-4 tabular-nums">{timestamp}</span>
      <span className="whitespace-pre-wrap break-all flex-1">{highlightedMessage}</span>
    </div>
  );
}
