'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ClipboardCopy,
  Eye,
  EyeOff,
  FileCode2,
  FileUp,
  KeyRound,
  ListFilter,
  Plus,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  EnvEntry,
  isValidEnvKey,
  looksLikeEnvContent,
  normalizeEnvKey,
  parseEnv,
  stringifyEnv,
} from '@/lib/env-parser';
import { cn } from '@/lib/utils';

export interface EnvRow extends EnvEntry {
  id: string;
}

let nextRowId = 0;
const newId = () => `env-${++nextRowId}`;

export const toEnvRows = (entries: EnvEntry[]): EnvRow[] =>
  entries.map((e) => ({ ...e, id: newId() }));

/** Rows with a name, trimmed. Empty rows are drafts and are dropped. */
export const envRowsToEntries = (rows: EnvRow[]): EnvEntry[] =>
  rows.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), value: r.value }));

export const envRowsToRecord = (rows: EnvRow[]) =>
  Object.fromEntries(envRowsToEntries(rows).map((e) => [e.key, e.value]));

/** First problem that should block saving, or null. */
export function envRowsError(rows: EnvRow[]): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) {
      if (row.value) return 'A variable has a value but no name';
      continue;
    }
    if (!isValidEnvKey(key)) return `"${key}" is not a valid variable name`;
    if (seen.has(key)) return `"${key}" is defined more than once`;
    seen.add(key);
  }
  return null;
}

/**
 * Merges parsed entries into rows: existing names get the new value, new names
 * are appended, and empty draft rows are dropped.
 */
function mergeEntries(rows: EnvRow[], entries: EnvEntry[]) {
  const next = rows.filter((r) => r.key.trim() || r.value).map((r) => ({ ...r }));
  let added = 0;
  let updated = 0;
  for (const entry of entries) {
    const existing = next.find((r) => r.key.trim() === entry.key);
    if (existing) {
      if (existing.value !== entry.value) {
        existing.value = entry.value;
        updated++;
      }
    } else {
      next.push({ ...entry, id: newId() });
      added++;
    }
  }
  return { rows: next, added, updated };
}

const summary = (added: number, updated: number) =>
  [added && `${added} added`, updated && `${updated} updated`].filter(Boolean).join(', ') ||
  'No changes';

interface EnvEditorProps {
  rows: EnvRow[];
  onChange: (rows: EnvRow[]) => void;
  /** Saved values, to mark rows as new / edited and list removed ones. */
  baseline?: EnvEntry[];
  /** Hint shown in the empty state. */
  emptyHint?: string;
  className?: string;
}

/**
 * Full environment-variable editor: a table with per-row reveal, a raw `.env`
 * view that stays in sync, paste/drop/import of whole files, and inline
 * validation. Shared by project creation and the project's Environment tab.
 */
export function EnvEditor({ rows, onChange, baseline, emptyHint, className }: EnvEditorProps) {
  const [mode, setMode] = useState<'table' | 'raw'>('table');
  const [rawText, setRawText] = useState('');
  const [revealAll, setRevealAll] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const keyInputs = useRef(new Map<string, HTMLInputElement>());

  const baselineMap = useMemo(
    () => new Map((baseline ?? []).map((e) => [e.key, e.value])),
    [baseline],
  );
  const named = rows.filter((r) => r.key.trim());
  const keyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = r.key.trim();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [rows]);
  const removed = baseline ? baseline.filter((b) => !rows.some((r) => r.key.trim() === b.key)) : [];
  const rawParse = useMemo(() => (mode === 'raw' ? parseEnv(rawText) : null), [mode, rawText]);

  const visibleRows = query
    ? rows.filter((r) => r.key.toLowerCase().includes(query.toLowerCase()))
    : rows;

  const focusKey = (id: string) => requestAnimationFrame(() => keyInputs.current.get(id)?.focus());

  const addRow = () => {
    const row = { id: newId(), key: '', value: '' };
    onChange([...rows, row]);
    setQuery('');
    focusKey(row.id);
  };

  const update = (id: string, patch: Partial<EnvEntry>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => {
    const index = rows.findIndex((r) => r.id === id);
    const row = rows[index];
    const next = rows.filter((r) => r.id !== id);
    onChange(next);
    if (row && (row.key || row.value)) {
      toast(`Removed ${row.key || 'variable'}`, {
        action: {
          label: 'Undo',
          onClick: () => {
            const restored = [...next];
            restored.splice(index, 0, row);
            onChange(restored);
          },
        },
      });
    }
  };

  const restore = (entry: EnvEntry) => onChange([...rows, { ...entry, id: newId() }]);

  const importText = (text: string, source: string) => {
    const result = parseEnv(text);
    if (!result.entries.length) {
      toast.error(`No variables found in ${source}`, {
        description: result.errors[0]
          ? `Line ${result.errors[0].line}: ${result.errors[0].message}`
          : undefined,
      });
      return false;
    }
    const merged = mergeEntries(rows, result.entries);
    onChange(merged.rows);
    const problems = result.errors.length
      ? ` · ${result.errors.length} line${result.errors.length === 1 ? '' : 's'} skipped`
      : '';
    toast.success(`Imported from ${source}`, {
      description: `${summary(merged.added, merged.updated)}${problems}`,
    });
    return true;
  };

  const handleFieldPaste = (
    e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    row: EnvRow,
    field: 'key' | 'value',
  ) => {
    const text = e.clipboardData.getData('text');
    if (looksLikeEnvContent(text, { singleLine: field === 'key' })) {
      e.preventDefault();
      // Pasting into an empty row replaces it instead of leaving a blank row behind.
      const base = !row.key && !row.value ? rows.filter((r) => r.id !== row.id) : rows;
      const result = parseEnv(text);
      if (!result.entries.length) return;
      const merged = mergeEntries(base, result.entries);
      onChange(merged.rows);
      toast.success(
        `Pasted ${result.entries.length} variable${result.entries.length === 1 ? '' : 's'}`,
        {
          description: summary(merged.added, merged.updated),
        },
      );
    } else if (field === 'value' && /[\r\n]/.test(text)) {
      // Multi-line values (certificates, keys): keep the line breaks.
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart ?? row.value.length;
      const end = target.selectionEnd ?? row.value.length;
      update(row.id, {
        value: row.value.slice(0, start) + text.replace(/\r\n?/g, '\n') + row.value.slice(end),
      });
    }
  };

  const readFile = async (file: File) => {
    if (file.size > 512 * 1024) {
      toast.error('That file is too large for an env file');
      return;
    }
    importText(await file.text(), file.name);
  };

  const switchMode = (next: 'table' | 'raw') => {
    if (next === mode) return;
    if (next === 'raw') setRawText(stringifyEnv(envRowsToEntries(rows)));
    setMode(next);
  };

  const onRawChange = (text: string) => {
    setRawText(text);
    // Keep the table in sync, reusing row ids by name so badges and focus survive.
    const ids = new Map(rows.map((r) => [r.key.trim(), r.id]));
    onChange(parseEnv(text).entries.map((e) => ({ ...e, id: ids.get(e.key) ?? newId() })));
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(stringifyEnv(envRowsToEntries(rows)));
      toast.success(`Copied ${named.length} variable${named.length === 1 ? '' : 's'} as .env`);
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  const isRevealed = (id: string) => revealAll || revealed.has(id);
  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className={cn('relative space-y-3', className)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        e.preventDefault();
        setDragging(false);
        void readFile(file);
      }}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Editor mode"
          className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5 text-xs"
        >
          {(
            [
              ['table', ListFilter, 'Table'],
              ['raw', FileCode2, '.env'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => switchMode(value)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === value
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        <span className="text-xs text-muted-foreground">
          {named.length} variable{named.length === 1 ? '' : 's'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {mode === 'table' && named.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRevealAll((v) => !v)}
              className="h-8 gap-1.5 px-2 text-xs"
              aria-pressed={revealAll}
            >
              {revealAll ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              <span className="hidden sm:inline">{revealAll ? 'Hide' : 'Reveal'}</span>
            </Button>
          )}
          {named.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={copyAll}
              className="h-8 gap-1.5 px-2 text-xs"
              title="Copy all as .env"
            >
              <ClipboardCopy className="size-3.5" />
              <span className="hidden sm:inline">Copy</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInput.current?.click()}
            className="h-8 gap-1.5 px-2 text-xs"
            title="Import a .env file"
          >
            <FileUp className="size-3.5" />
            <span className="hidden sm:inline">Import</span>
          </Button>
          {mode === 'table' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              className="h-8 gap-1.5 text-xs"
            >
              <Plus className="size-3.5" /> Add
            </Button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".env,.txt,.json,text/plain,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {mode === 'raw' ? (
        <div className="space-y-2">
          <Textarea
            value={rawText}
            onChange={(e) => onRawChange(e.target.value)}
            rows={Math.min(18, Math.max(8, rawText.split('\n').length + 1))}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={
              '# Paste a .env file, KEY: value lines or a JSON object\nDATABASE_URL=postgres://user:pass@host:5432/db\nAPI_KEY="secret value"'
            }
            className="font-mono text-xs leading-relaxed"
            aria-label=".env contents"
          />
          {rawParse && (rawParse.errors.length > 0 || rawParse.warnings.length > 0) && (
            <ul className="space-y-1 rounded-lg border border-border bg-surface-muted/50 p-2.5 text-xs">
              {rawParse.errors.map((issue) => (
                <li key={`e${issue.line}`} className="flex gap-2 text-destructive">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="font-mono">Line {issue.line}:</span> {issue.message} — not
                    included.
                  </span>
                </li>
              ))}
              {rawParse.warnings.map((issue) => (
                <li
                  key={`w${issue.line}`}
                  className="flex gap-2 text-amber-800 dark:text-amber-300"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="font-mono">Line {issue.line}:</span> {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Changes here update the table as you type. Quotes, <code>export</code>, comments and
            multi-line values are supported.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <button
          type="button"
          onClick={addRow}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (text.trim()) {
              e.preventDefault();
              importText(text, 'clipboard');
            }
          }}
          className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-10 text-center transition-colors hover:border-foreground/25 hover:bg-surface-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <KeyRound className="size-5" />
          </span>
          <span className="mt-3 text-sm font-semibold text-foreground">No variables yet</span>
          <span className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            {emptyHint ??
              'Add one, paste a whole .env file into any field, or drop a .env file here.'}
          </span>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
            <Plus className="size-3.5" /> Add variable
          </span>
        </button>
      ) : (
        <div className="space-y-2">
          {rows.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name"
                aria-label="Filter variables by name"
                className="h-9 pl-8 text-sm"
              />
            </div>
          )}

          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Name</span>
            <span>Value</span>
            <span className="sr-only">Actions</span>
          </div>

          <ul className="space-y-2">
            {visibleRows.map((row) => {
              const key = row.key.trim();
              const invalidKey = !!key && !isValidEnvKey(key);
              const duplicate = !!key && (keyCounts.get(key) ?? 0) > 1;
              const missingKey = !key && !!row.value;
              const status = !baseline
                ? null
                : !baselineMap.has(key)
                  ? key
                    ? 'new'
                    : null
                  : baselineMap.get(key) !== row.value
                    ? 'edited'
                    : null;
              const multiline = row.value.includes('\n');
              const shown = isRevealed(row.id);
              const problem = invalidKey
                ? 'Use letters, digits and _ (not starting with a digit)'
                : duplicate
                  ? 'This name is used more than once'
                  : missingKey
                    ? 'Give this value a name'
                    : null;

              return (
                <li
                  key={row.id}
                  className={cn(
                    'rounded-lg border border-border p-2 sm:border-0 sm:p-0',
                    status && 'border-l-2 sm:border-l-0',
                    status === 'new' && 'border-l-emerald-500',
                    status === 'edited' && 'border-l-amber-500',
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem]">
                    <div className="relative col-span-2 sm:col-span-1">
                      <Input
                        ref={(el) => {
                          if (el) keyInputs.current.set(row.id, el);
                          else keyInputs.current.delete(row.id);
                        }}
                        value={row.key}
                        onChange={(e) => update(row.id, { key: e.target.value })}
                        onBlur={() => {
                          const normalized = normalizeEnvKey(row.key);
                          if (normalized !== row.key) update(row.id, { key: normalized });
                        }}
                        onPaste={(e) => handleFieldPaste(e, row, 'key')}
                        placeholder="VARIABLE_NAME"
                        aria-label="Variable name"
                        aria-invalid={!!problem}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        className={cn('h-9 font-mono text-xs', status && 'pr-14')}
                      />
                      {status && (
                        <span
                          className={cn(
                            'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] font-medium',
                            status === 'new'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
                          )}
                        >
                          {status}
                        </span>
                      )}
                    </div>

                    {multiline && !shown ? (
                      <button
                        type="button"
                        onClick={() => toggleReveal(row.id)}
                        className="flex h-9 items-center gap-2 rounded-xl border border-border bg-surface-muted/60 px-3 text-left font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Reveal multi-line value for ${key || 'variable'}`}
                      >
                        ••••••{' '}
                        <span className="font-sans">
                          {row.value.split('\n').length} lines · tap to reveal
                        </span>
                      </button>
                    ) : multiline ? (
                      <Textarea
                        value={row.value}
                        onChange={(e) => update(row.id, { value: e.target.value })}
                        onPaste={(e) => handleFieldPaste(e, row, 'value')}
                        aria-label={`Value for ${key || 'variable'}`}
                        rows={Math.min(6, row.value.split('\n').length)}
                        spellCheck={false}
                        className="min-h-9 font-mono text-xs"
                      />
                    ) : (
                      <Input
                        type={shown ? 'text' : 'password'}
                        value={row.value}
                        onChange={(e) => update(row.id, { value: e.target.value })}
                        onPaste={(e) => handleFieldPaste(e, row, 'value')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && row.id === rows[rows.length - 1]?.id) {
                            e.preventDefault();
                            addRow();
                          }
                        }}
                        placeholder="value"
                        aria-label={`Value for ${key || 'variable'}`}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-9 font-mono text-xs"
                      />
                    )}

                    <div className="flex items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground"
                        onClick={() => toggleReveal(row.id)}
                        aria-label={shown ? `Hide ${key || 'value'}` : `Show ${key || 'value'}`}
                        aria-pressed={shown}
                      >
                        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => remove(row.id)}
                        aria-label={`Delete ${key || 'variable'}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {problem && (
                    <p className="mt-1 flex items-center gap-1 px-1 text-xs text-destructive">
                      <AlertCircle className="size-3" /> {problem}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {query && visibleRows.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No variables match “{query}”.
            </p>
          )}

          <button
            type="button"
            onClick={addRow}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" /> Add another
            <span className="hidden sm:inline">· or paste a .env file into any field</span>
          </button>
        </div>
      )}

      {removed.length > 0 && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-2.5 text-xs">
          <p className="mb-1.5 font-medium text-destructive">
            Will be deleted when you save ({removed.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {removed.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => restore(entry)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground/80 line-through decoration-destructive/60 hover:no-underline hover:text-foreground"
                title="Restore"
              >
                {entry.key}
                <Undo2 className="size-3 no-underline" />
              </button>
            ))}
          </div>
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-500/60 bg-background/85 backdrop-blur-sm">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Check className="size-4" /> Drop to import variables
          </span>
        </div>
      )}
    </div>
  );
}
