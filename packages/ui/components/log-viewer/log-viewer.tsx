'use client';

import { Button } from '@/components/ui/button';
import { useBuildLogs } from '@/hooks/use-realtime';
import { api } from '@/lib/api';
import { LogLevel } from '@/lib/types';
import { useLogStore } from '@/stores/log-store';
import { ArrowDownCircle, Loader2 } from 'lucide-react';
import { UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { LogActions } from './log-actions';
import { LogFilter } from './log-filter';
import { LogLine } from './log-line';
import { LogSearch } from './log-search';

interface LogViewerProps {
  buildId: string;
}

export function LogViewer({ buildId }: LogViewerProps) {
  const { logs, appendLog, setLogs, clearLogs } = useLogStore();
  const logEntries = logs[buildId] || [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentMatchRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<LogLevel>>(new Set());

  // Count errors and warnings
  const { errorCount, warningCount } = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const entry of logEntries) {
      if (entry.level === 'error') errors++;
      if (entry.level === 'warning') warnings++;
    }
    return { errorCount: errors, warningCount: warnings };
  }, [logEntries]);

  // Filter logs by active filters
  const filteredEntries = useMemo(() => {
    if (activeFilters.size === 0) return logEntries;
    return logEntries.filter((entry) => activeFilters.has(entry.level));
  }, [logEntries, activeFilters]);

  // Find matching lines in filtered entries
  const matchingIndices = useMemo(() => {
    if (!searchTerm) return [];
    return filteredEntries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.message.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(({ index }) => index);
  }, [filteredEntries, searchTerm]);

  // Toggle filter
  const handleToggleFilter = useCallback((level: LogLevel) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  // Navigate to match
  const goToMatch = useCallback(
    (index: number) => {
      if (matchingIndices.length === 0) return;
      const wrappedIndex =
        ((index % matchingIndices.length) + matchingIndices.length) % matchingIndices.length;
      setCurrentMatchIndex(wrappedIndex);
      setAutoScroll(false);
    },
    [matchingIndices],
  );

  // Scroll to current match
  useEffect(() => {
    if (currentMatchRef.current && searchTerm && matchingIndices.length > 0) {
      currentMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentMatchIndex, searchTerm, matchingIndices]);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchTerm('');
      }
      if (e.key === 'Enter' && showSearch && matchingIndices.length > 0) {
        if (e.shiftKey) {
          goToMatch(currentMatchIndex - 1);
        } else {
          goToMatch(currentMatchIndex + 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch, matchingIndices, currentMatchIndex, goToMatch]);

  // Fetch initial logs
  useEffect(() => {
    let mounted = true;
    const fetchLogs = async () => {
      try {
        if (logEntries.length === 0) {
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
  }, [buildId, setLogs, logEntries.length]);

  // Realtime logs via SSE or Socket.IO
  const handleLog = useCallback(
    (message: string, level: string) => {
      appendLog(buildId, message, level as LogLevel);
    },
    [buildId, appendLog],
  );
  useBuildLogs(buildId, handleLog);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && scrollRef.current && !searchTerm) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEntries, autoScroll, searchTerm]);

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = Math.abs(target.scrollHeight - target.scrollTop - target.clientHeight) < 20;
    setIsScrolledToBottom(isAtBottom);
    if (autoScroll && !isAtBottom) setAutoScroll(false);
    else if (!autoScroll && isAtBottom) setAutoScroll(true);
  };

  const handleCopy = () => {
    const textContent = filteredEntries.map((e) => e.message).join('');
    navigator.clipboard.writeText(textContent);
    toast.success('Logs copied to clipboard');
  };

  const handleDownload = () => {
    const textContent = filteredEntries
      .map((e) => `[${new Date(e.timestamp).toISOString()}] ${e.message}`)
      .join('');
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `build-${buildId}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = async () => {
    setIsClearing(true);
    try {
      await api.clearBuildLogs(buildId);
      clearLogs(buildId);
      toast.success('Logs cleared');
    } catch (error) {
      toast.error('Failed to clear logs');
    } finally {
      setIsClearing(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const freshLogs = await api.getBuildLogs(buildId);
      if (freshLogs) {
        setLogs(buildId, freshLogs);
        toast.success('Logs refreshed');
      }
    } catch (error) {
      toast.error('Failed to refresh logs');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-white overflow-hidden border border-zinc-800 rounded-lg relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            Build Logs
          </span>
          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
          <span className="text-xs text-zinc-600">{filteredEntries.length} lines</span>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
          {/* Log level filters */}
          <LogFilter
            errorCount={errorCount}
            warningCount={warningCount}
            activeFilters={activeFilters}
            onToggleFilter={handleToggleFilter}
          />

          <div className="w-px h-4 bg-zinc-800 hidden sm:block" />

          {/* Search */}
          {showSearch ? (
            <LogSearch
              searchTerm={searchTerm}
              setSearchTerm={(term) => {
                setSearchTerm(term);
                setCurrentMatchIndex(0);
              }}
              matchCount={matchingIndices.length}
              currentMatchIndex={currentMatchIndex}
              onPrevMatch={() => goToMatch(currentMatchIndex - 1)}
              onNextMatch={() => goToMatch(currentMatchIndex + 1)}
              onClose={() => {
                setShowSearch(false);
                setSearchTerm('');
              }}
            />
          ) : (
            <LogActions
              onCopy={handleCopy}
              onDownload={handleDownload}
              onClear={handleClearLogs}
              onOpenSearch={() => setShowSearch(true)}
              onRefresh={handleRefresh}
              isClearing={isClearing}
              isRefreshing={isRefreshing}
              disabled={filteredEntries.length === 0}
            />
          )}
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-1 px-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-700 hover:scrollbar-thumb-zinc-600"
        onScroll={handleScroll}
      >
        {filteredEntries.length > 0 ? (
          filteredEntries.map((entry, idx) => {
            const matchIdx = matchingIndices.indexOf(idx);
            const isCurrentMatch = matchIdx === currentMatchIndex && searchTerm !== '';
            return (
              <LogLine
                key={entry.id || idx}
                entry={entry}
                searchTerm={searchTerm}
                isCurrentMatch={isCurrentMatch}
                lineRef={isCurrentMatch ? currentMatchRef : undefined}
              />
            );
          })
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            {isLoading
              ? 'Loading logs...'
              : activeFilters.size > 0
                ? 'No matching logs'
                : 'Waiting for logs...'}
          </div>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {!autoScroll && !isScrolledToBottom && (
        <Button
          size="sm"
          className="absolute bottom-6 right-6 shadow-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
          onClick={() => setAutoScroll(true)}
        >
          <ArrowDownCircle className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
