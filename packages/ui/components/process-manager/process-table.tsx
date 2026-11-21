'use client';

import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Copy,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCcw,
  RotateCw,
  ScrollText,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/components/ui/copy-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot, TONE_TEXT } from '@/components/ui/status';
import { formatBytes, formatUptime } from '@/lib/format';
import { processTarget, type PM0Process } from '@/lib/pm0-api';
import { cn } from '@/lib/utils';
import { processCommand, processStatus, restartsExhausted, restartsLabel } from './process-utils';
import type { ProcessAction } from './use-process-actions';

export type SortKey = 'attention' | 'name' | 'cpu' | 'memory' | 'uptime' | 'restarts';
export interface SortState {
  key: SortKey;
  desc: boolean;
}

const COLUMNS = 'lg:grid-cols-[1.25rem_minmax(0,1fr)_6.5rem_4.5rem_5.5rem_5.5rem_5rem_6.5rem]';

interface ProcessTableProps {
  groups: { key: string; title: string; note?: string; processes: PM0Process[] }[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  selectedIds: Set<string>;
  onToggleSelect: (target: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  onOpen: (process: PM0Process) => void;
  onAction: (action: ProcessAction, process: PM0Process) => void;
  isPending: (process: PM0Process, action?: ProcessAction) => boolean;
}

export function ProcessTable({
  groups,
  sort,
  onSort,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  allSelected,
  onOpen,
  onAction,
  isPending,
}: ProcessTableProps) {
  const someSelected = selectedIds.size > 0 && !allSelected;
  const showGroupHeads = groups.length > 1;

  return (
    <div role="table" aria-label="Processes">
      <div
        role="row"
        className={cn(
          'hidden items-center gap-4 border-b border-border bg-surface-muted/40 px-5 py-2 text-xs text-muted-foreground lg:grid',
          COLUMNS,
        )}
      >
        <span role="columnheader">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={onToggleAll}
            aria-label="Select all shown processes"
            className="size-3.5 cursor-pointer accent-brand-500"
          />
        </span>
        <SortHeader label="Process" sortKey="name" sort={sort} onSort={onSort} />
        <span role="columnheader">Status</span>
        <SortHeader label="CPU" sortKey="cpu" sort={sort} onSort={onSort} />
        <SortHeader label="Memory" sortKey="memory" sort={sort} onSort={onSort} />
        <SortHeader label="Uptime" sortKey="uptime" sort={sort} onSort={onSort} />
        <SortHeader label="Restarts" sortKey="restarts" sort={sort} onSort={onSort} />
        <span role="columnheader" className="sr-only">
          Actions
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.key} role="rowgroup">
          {showGroupHeads && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border bg-surface-muted/20 px-4 py-2 sm:px-5">
              <span className="text-xs font-medium text-foreground">{group.title}</span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {group.processes.length}
              </span>
              {group.note && <span className="text-xs text-muted-foreground">{group.note}</span>}
            </div>
          )}
          <div className="divide-y divide-border border-b border-border last:border-b-0">
            {group.processes.map((process) => (
              <ProcessRow
                key={processTarget(process)}
                process={process}
                selected={selectedIds.has(processTarget(process))}
                onToggleSelect={() => onToggleSelect(processTarget(process))}
                onOpen={() => onOpen(process)}
                onAction={(action) => onAction(action, process)}
                isPending={(action) => isPending(process, action)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <span
      role="columnheader"
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          active && 'text-foreground',
        )}
      >
        {label}
        {active && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </span>
  );
}

function ProcessRow({
  process,
  selected,
  onToggleSelect,
  onOpen,
  onAction,
  isPending,
}: {
  process: PM0Process;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onAction: (action: ProcessAction) => void;
  isPending: (action?: ProcessAction) => boolean;
}) {
  const status = processStatus(process.status);
  const online = process.status === 'online';
  const errored = process.status === 'errored';
  const command = processCommand(process);
  const exhausted = restartsExhausted(process);
  const busy = isPending();
  const metric = 'hidden font-mono text-xs tabular-nums lg:block';

  return (
    <div
      role="row"
      onClick={(event) => {
        // The row opens the inspector unless the click was on a control inside it.
        if ((event.target as HTMLElement).closest('button, a, input, [role="menuitem"]')) return;
        onOpen();
      }}
      className={cn(
        'grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-surface-muted/40 sm:px-5 lg:gap-x-4',
        COLUMNS,
        errored && 'bg-red-500/[0.035]',
        selected && 'bg-brand-500/[0.06] hover:bg-brand-500/[0.09]',
      )}
    >
      <span role="cell" className="flex items-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${process.name}`}
          className="size-3.5 cursor-pointer accent-brand-500"
        />
      </span>

      <div role="cell" className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot tone={status.tone} pulse={status.tone === 'progress'} className="lg:hidden" />
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 cursor-pointer truncate rounded-sm text-left text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {process.name}
          </button>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            #{process.pm_id}
          </span>
        </div>
        <p
          className="mt-0.5 hidden truncate font-mono text-[11.5px] text-muted-foreground lg:block"
          title={command.full}
        >
          {command.short}
        </p>
        {/* Phones: one plain line of usage instead of columns. */}
        <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground tabular-nums lg:hidden">
          {online ? (
            <>
              {process.monit.cpu.toFixed(1)}% · {formatBytes(process.monit.memory)} · up{' '}
              {formatUptime(process.pm_uptime)}
            </>
          ) : (
            <span className={errored ? TONE_TEXT.error : undefined}>
              {status.label.toLowerCase()}
              {errored && process.exit_code != null && ` · exit ${process.exit_code}`}
            </span>
          )}
          {process.restart_time > 0 && (
            <span className={exhausted ? TONE_TEXT.error : undefined}>
              {' '}
              · {restartsLabel(process)} restarts
            </span>
          )}
        </p>
      </div>

      <span role="cell" className="hidden lg:block">
        <span
          className={cn(
            'inline-flex items-center gap-2 text-[13px]',
            errored ? TONE_TEXT.error : 'text-foreground',
          )}
        >
          <StatusDot tone={status.tone} pulse={status.tone === 'progress'} />
          {status.label}
        </span>
        {errored && process.exit_code != null && (
          <span className="block pl-4 font-mono text-[11px] text-muted-foreground">
            exit {process.exit_code}
          </span>
        )}
      </span>
      <span role="cell" className={cn(metric, !online && 'text-muted-foreground/60')}>
        {online ? `${process.monit.cpu.toFixed(1)}%` : '—'}
      </span>
      <span role="cell" className={cn(metric, !online && 'text-muted-foreground/60')}>
        {online ? formatBytes(process.monit.memory) : '—'}
      </span>
      <span role="cell" className={cn(metric, !online && 'text-muted-foreground/60')}>
        {online ? formatUptime(process.pm_uptime) : '—'}
      </span>
      <span
        role="cell"
        className={cn(
          metric,
          exhausted ? TONE_TEXT.error : process.restart_time === 0 && 'text-muted-foreground/60',
        )}
        title={
          process.unstable_restarts > 0
            ? `${process.unstable_restarts} unstable restarts`
            : undefined
        }
      >
        {restartsLabel(process)}
      </span>

      <div role="cell" className="row-span-2 flex items-center justify-end gap-0.5 lg:row-span-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden text-muted-foreground sm:inline-flex"
          onClick={onOpen}
          title="Logs and details"
          aria-label={`Logs and details for ${process.name}`}
        >
          <ScrollText className="size-3.5" />
        </Button>
        {online ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => onAction('restart')}
            disabled={busy}
            title="Restart"
            aria-label={`Restart ${process.name}`}
          >
            {isPending('restart') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCw className="size-3.5" />
            )}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
            onClick={() => onAction('start')}
            disabled={busy}
            title="Start"
            aria-label={`Start ${process.name}`}
          >
            {isPending('start') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
          </Button>
        )}
        <ProcessMenu process={process} onAction={onAction} busy={busy} />
      </div>
    </div>
  );
}

export function ProcessMenu({
  process,
  onAction,
  busy,
  align = 'end',
  showProjectLink = true,
}: {
  process: PM0Process;
  onAction: (action: ProcessAction) => void;
  busy: boolean;
  align?: 'start' | 'end';
  /** Off where the menu already sits on the project's own page. */
  showProjectLink?: boolean;
}) {
  const online = process.status === 'online';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          aria-label={`More actions for ${process.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-48">
        {showProjectLink && process.project_id && (
          <>
            <DropdownMenuItem asChild>
              <Link href={`/projects/${process.project_id}`}>
                <ArrowUpRight />
                Open project
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={busy} onSelect={() => onAction(online ? 'restart' : 'start')}>
          {online ? <RotateCw /> : <Play />}
          {online ? 'Restart' : 'Start'}
        </DropdownMenuItem>
        {online && (
          <DropdownMenuItem disabled={busy} onSelect={() => onAction('reload')}>
            <RefreshCcw />
            Reload gracefully
          </DropdownMenuItem>
        )}
        {online && (
          <DropdownMenuItem disabled={busy} onSelect={() => onAction('stop')}>
            <Square />
            Stop
          </DropdownMenuItem>
        )}
        {process.cwd && (
          <DropdownMenuItem onSelect={() => void copyText(process.cwd, 'Copied working directory')}>
            <Copy />
            Copy working directory
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onAction('delete')}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
