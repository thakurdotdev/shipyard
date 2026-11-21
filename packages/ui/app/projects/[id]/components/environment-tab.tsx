'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Project, EnvVar } from '@/lib/types';
import { EnvEntry } from '@/lib/env-parser';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import {
  EnvEditor,
  EnvRow,
  envRowsError,
  envRowsToEntries,
  toEnvRows,
} from '@/components/env/env-editor';

interface EnvironmentTabProps {
  project: Project;
  /** A live deployment exists and nothing is deploying, so a redeploy can apply changes. */
  canRedeploy: boolean;
  onRedeploy: () => void;
}

export function EnvironmentTab({ project, canRedeploy, onRedeploy }: EnvironmentTabProps) {
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [saved, setSaved] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getEnvVars(project.id);
      const entries = (data || []).map((v: EnvVar) => ({ key: v.key, value: v.value }));
      setSaved(entries);
      setRows(toEnvRows(entries));
    } catch (err) {
      console.error(err);
      setLoadError(true);
      toast.error('Failed to load environment variables');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const current = envRowsToEntries(rows);
  const diff = useMemo(() => {
    const before = new Map(saved.map((e) => [e.key, e.value]));
    const after = new Map(current.map((e) => [e.key, e.value]));
    return {
      upserts: current.filter((e) => before.get(e.key) !== e.value),
      deletes: saved.filter((e) => !after.has(e.key)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, rows]);
  const changeCount = diff.upserts.length + diff.deletes.length;
  const blocking = envRowsError(rows);

  // Don't lose unsaved edits to an accidental tab close or reload.
  useEffect(() => {
    if (!changeCount) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changeCount]);

  const discard = () => {
    setRows(toEnvRows(saved));
    toast.info('Changes discarded');
  };

  const save = async () => {
    if (blocking) {
      toast.error(blocking);
      return;
    }
    setSaving(true);
    const results = await Promise.allSettled([
      ...diff.deletes.map((e) => api.deleteEnvVar(project.id, e.key)),
      ...diff.upserts.map((e) => api.addEnvVar(project.id, e)),
    ]);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      toast.error(`${failed} of ${results.length} changes failed to save`, {
        description: 'The ones that saved are kept. Try saving again.',
      });
    } else {
      toast.success('Environment variables saved', {
        description: canRedeploy
          ? 'Redeploy to apply them to the running app.'
          : 'They apply from the next deployment.',
        ...(canRedeploy ? { action: { label: 'Redeploy now', onClick: onRedeploy } } : {}),
      });
    }
    // Reload so the editor reflects exactly what the server has.
    try {
      const data = await api.getEnvVars(project.id);
      const entries = (data || []).map((v: EnvVar) => ({ key: v.key, value: v.value }));
      setSaved(entries);
      if (!failed) setRows(toEnvRows(entries));
    } catch {
      /* keep local state */
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4 pb-24 sm:pb-0">
      <Panel>
        <PanelHeader
          title="Environment variables"
          description="Encrypted at rest. Injected into builds and the running app on the next deploy."
          actions={
            canRedeploy && (
              <Button variant="outline" size="sm" onClick={onRedeploy} disabled={changeCount > 0}>
                <RotateCcw />
                Redeploy to apply
              </Button>
            )
          }
        />
        <div className="px-4 py-4 sm:px-5">
          {loading ? (
            <div className="h-44 animate-pulse rounded-lg bg-surface-muted/50" />
          ) : loadError ? (
            <EmptyState
              title="Couldn’t load the variables"
              action={
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <EnvEditor rows={rows} onChange={setRows} baseline={saved} />
          )}
        </div>
      </Panel>

      {changeCount > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-background/95 p-3 backdrop-blur animate-in slide-in-from-bottom-2 sm:sticky sm:bottom-4 sm:rounded-xl sm:border sm:border-border-strong sm:bg-popover sm:shadow-xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <p className="min-w-0 text-xs">
              <span className="font-medium text-foreground">
                {changeCount} unsaved change{changeCount === 1 ? '' : 's'}
              </span>
              <span className="block truncate text-muted-foreground">
                {blocking ??
                  [
                    diff.upserts.length && `${diff.upserts.length} to save`,
                    diff.deletes.length && `${diff.deletes.length} to delete`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
              </span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
                <RotateCcw className="size-3.5" />
                <span className="hidden sm:inline">Discard</span>
              </Button>
              <Button size="sm" onClick={save} disabled={saving || !!blocking}>
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
