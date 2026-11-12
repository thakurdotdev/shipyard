'use client';

import { useEffect, useMemo, useState } from 'react';
import { Info, KeyRound, Loader2, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Project, EnvVar } from '@/lib/types';
import { EnvEntry } from '@/lib/env-parser';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  EnvEditor,
  EnvRow,
  envRowsError,
  envRowsToEntries,
  toEnvRows,
} from '@/components/env/env-editor';

interface EnvironmentTabProps {
  project: Project;
}

export function EnvironmentTab({ project }: EnvironmentTabProps) {
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
        description: 'They apply from the next deployment.',
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
    <div className="space-y-4 pb-24 animate-in fade-in-50 duration-300 sm:pb-0">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground">
              <KeyRound className="size-4" />
            </span>
            <div>
              <CardTitle>Environment variables</CardTitle>
              <CardDescription className="mt-1">
                Encrypted at rest and injected into builds and the running app.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex h-44 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
              Could not load the variables.
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : (
            <EnvEditor rows={rows} onChange={setRows} baseline={saved} />
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 surface-card rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          Changes apply from the next deployment. Redeploy the current build to pick them up now.
        </p>
      </div>

      {changeCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur animate-in slide-in-from-bottom-2 sm:sticky sm:bottom-4 sm:rounded-xl sm:border sm:bg-card sm:shadow-lg">
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
