'use client';

import { useEffect, useState } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BranchList } from '@/lib/types';
import { cn } from '@/lib/utils';

interface BranchSelectProps {
  id?: string;
  value: string;
  onChange: (branch: string) => void;
  /** Loads the branches. Called again whenever `sourceKey` changes. */
  load: () => Promise<BranchList>;
  sourceKey: string;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
}

/**
 * Picks a repository branch. The current value always stays selectable, so the field
 * works while branches load, when listing fails, or when the list was cut short.
 */
export function BranchSelect({
  id,
  value,
  onChange,
  load,
  sourceKey,
  disabled,
  className,
  'aria-describedby': describedBy,
}: BranchSelectProps) {
  const [list, setList] = useState<BranchList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((data) => {
        if (!cancelled) setList(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Could not list branches');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `load` is usually an inline closure; `sourceKey` says when it means something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const names = list?.branches.map((b) => b.name) ?? [];
  const options = value && !names.includes(value) ? [value, ...names] : names;

  return (
    <div className="space-y-1.5">
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          aria-describedby={describedBy}
          className={cn('w-full font-mono text-sm', className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GitBranch className="size-4" />
            )}
            <SelectValue placeholder="Select a branch" />
          </span>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((name) => (
            <SelectItem key={name} value={name} className="font-mono text-sm">
              {name}
              {name === list?.default_branch && (
                <span className="ml-1 font-sans text-xs text-muted-foreground">default</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p className="text-xs text-destructive">Couldn&apos;t load branches: {error}</p>
      ) : list?.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {list.branches.length} branches.
        </p>
      ) : null}
    </div>
  );
}
