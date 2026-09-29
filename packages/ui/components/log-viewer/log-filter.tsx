'use client';

import { LogLevel } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { AlertCircle, AlertTriangle, Info, CheckCircle, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogFilterProps {
  errorCount: number;
  warningCount: number;
  activeFilters: Set<LogLevel>;
  onToggleFilter: (level: LogLevel) => void;
}

export function LogFilter({
  errorCount,
  warningCount,
  activeFilters,
  onToggleFilter,
}: LogFilterProps) {
  const isFiltered = (level: LogLevel) => activeFilters.has(level);

  return (
    <div className="flex items-center gap-1">
      {/* Error filter */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-6 text-xs gap-1 px-2',
          isFiltered('error')
            ? 'bg-red-950/50 text-red-400 hover:bg-red-950/70'
            : 'text-console-muted hover:text-console-foreground hover:bg-console-surface',
        )}
        onClick={() => onToggleFilter('error')}
      >
        <AlertCircle className="w-3 h-3" />
        <span>{errorCount}</span>
      </Button>

      {/* Warning filter */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-6 text-xs gap-1 px-2',
          isFiltered('warning')
            ? 'bg-amber-950/50 text-amber-400 hover:bg-amber-950/70'
            : 'text-console-muted hover:text-console-foreground hover:bg-console-surface',
        )}
        onClick={() => onToggleFilter('warning')}
      >
        <AlertTriangle className="w-3 h-3" />
        <span>{warningCount}</span>
      </Button>
    </div>
  );
}
