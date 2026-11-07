'use client';

import { useEffect, useState } from 'react';
import {
  KeyRound,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Save,
  Loader2,
  FileCode2,
  ListFilter,
  Info,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Project, EnvVar } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

interface EnvironmentTabProps {
  project: Project;
}

interface EnvVarRow {
  key: string;
  value: string;
}

export function EnvironmentTab({ project }: EnvironmentTabProps) {
  const [vars, setVars] = useState<EnvVarRow[]>([]);
  const [initialVars, setInitialVars] = useState<EnvVarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [editorMode, setEditorMode] = useState<'form' | 'raw'>('form');
  const [rawText, setRawText] = useState('');

  const loadEnvVars = async () => {
    setLoading(true);
    try {
      const data = await api.getEnvVars(project.id);
      const formatted: EnvVarRow[] = (data || []).map((v: EnvVar) => ({
        key: v.key,
        value: v.value,
      }));
      setVars(formatted);
      setInitialVars(formatted);
      setRawText(
        formatted
          .map((v) => `${v.key}=${v.value.includes('\n') ? `"${v.value}"` : v.value}`)
          .join('\n'),
      );
      setHasChanges(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load environment variables');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEnvVars();
  }, [project.id]);

  const parseEnvContent = (text: string): EnvVarRow[] => {
    const parsed: EnvVarRow[] = [];
    const lines = text.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const match = line.match(/^([A-Za-z_0-9]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        parsed.push({ key, value });
      }
    }

    return parsed;
  };

  const addRow = () => {
    setVars((prev) => [...prev, { key: '', value: '' }]);
    setHasChanges(true);
  };

  const removeRow = (index: number) => {
    setVars((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const updateRow = (index: number, field: 'key' | 'value', value: string) => {
    setVars((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    setHasChanges(true);
  };

  const handleInlinePaste = (e: React.ClipboardEvent, index: number) => {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n') || text.includes('=')) {
      e.preventDefault();
      const pasted = parseEnvContent(text);
      if (pasted.length > 0) {
        setVars((prev) => {
          const current = [...prev];
          const isTargetEmpty = !current[index]?.key && !current[index]?.value;
          if (isTargetEmpty) {
            current.splice(index, 1, ...pasted);
          } else {
            current.splice(index + 1, 0, ...pasted);
          }
          return current;
        });
        setHasChanges(true);
        toast.info(`Parsed and imported ${pasted.length} variable(s)`);
      }
    }
  };

  const handleApplyRaw = () => {
    const parsed = parseEnvContent(rawText);
    setVars(parsed);
    setHasChanges(true);
    setEditorMode('form');
    toast.success(`Applied ${parsed.length} variable(s) from .env text`);
  };

  const handleSwitchToRaw = () => {
    setRawText(
      vars
        .filter((v) => v.key.trim())
        .map((v) => `${v.key.trim()}=${v.value.includes('\n') ? `"${v.value}"` : v.value}`)
        .join('\n'),
    );
    setEditorMode('raw');
  };

  const handleDiscard = () => {
    setVars(initialVars);
    setRawText(
      initialVars
        .map((v) => `${v.key}=${v.value.includes('\n') ? `"${v.value}"` : v.value}`)
        .join('\n'),
    );
    setHasChanges(false);
    toast.info('Changes discarded');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const validRows = vars.filter((v) => v.key.trim().length > 0);
      const currentKeys = new Set(validRows.map((v) => v.key.trim()));

      // Identify deletions
      const toDelete = initialVars.filter((v) => !currentKeys.has(v.key.trim()));

      // Run deletions & upserts
      await Promise.all([
        ...toDelete.map((v) => api.deleteEnvVar(project.id, v.key.trim())),
        ...validRows.map((v) => api.addEnvVar(project.id, { key: v.key.trim(), value: v.value })),
      ]);

      await loadEnvVars();
      toast.success('Environment variables saved successfully');
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to save environment variables', {
        description: err.message || 'An unexpected error occurred',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground">
                <KeyRound className="h-4 w-4" />
              </span>
              <div>
                <CardTitle>Environment variables</CardTitle>
                <CardDescription className="mt-1">
                  Variables defined here are encrypted and injected into your build and runtime
                  environments.
                </CardDescription>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setEditorMode('form')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                  editorMode === 'form'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ListFilter className="h-3.5 w-3.5" />
                Table view
              </button>
              <button
                type="button"
                onClick={handleSwitchToRaw}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                  editorMode === 'raw'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <FileCode2 className="h-3.5 w-3.5" />
                Raw .env
              </button>
            </div>

            {editorMode === 'form' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowValues(!showValues)}
                className="h-8 gap-1.5 text-xs"
              >
                {showValues ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" /> Hide values
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" /> Show values
                  </>
                )}
              </Button>
            )}

            {editorMode === 'form' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                className="h-8 gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> Add variable
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex h-44 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : editorMode === 'raw' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Paste or edit your <code className="font-mono text-foreground">.env</code>{' '}
                  formatted variables below:
                </p>
                <Textarea
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setHasChanges(true);
                  }}
                  rows={10}
                  placeholder={`DATABASE_URL=postgresql://user:password@host/db\nAPI_SECRET=your_api_key_here\nNEXT_PUBLIC_APP_URL=https://myapp.com`}
                  className="font-mono text-xs leading-relaxed"
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Clicking apply will parse these lines into the structured table.
                </p>
                <Button size="sm" onClick={handleApplyRaw} className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Apply to table
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {vars.length > 0 && (
                <div className="hidden grid-cols-[1fr_1.5fr_2.25rem] gap-3 px-1 text-xs font-medium text-muted-foreground sm:grid">
                  <span>Key</span>
                  <span>Value</span>
                  <span className="sr-only">Actions</span>
                </div>
              )}

              {vars.map((row, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-x-3 gap-y-2 border-b border-border pb-3 last:border-0 last:pb-0 sm:grid-cols-[1fr_1.5fr_2.25rem] sm:border-0 sm:pb-0"
                >
                  <Input
                    placeholder="VARIABLE_NAME"
                    aria-label="Variable name"
                    value={row.key}
                    onChange={(e) => updateRow(index, 'key', e.target.value)}
                    onPaste={(e) => handleInlinePaste(e, index)}
                    className="font-mono text-xs uppercase"
                  />
                  <Input
                    placeholder="value"
                    aria-label={`Value for ${row.key || 'variable'}`}
                    type={showValues ? 'text' : 'password'}
                    value={row.value}
                    onChange={(e) => updateRow(index, 'value', e.target.value)}
                    onPaste={(e) => handleInlinePaste(e, index)}
                    className="col-start-1 row-start-2 font-mono text-xs sm:col-start-2 sm:row-start-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="col-start-2 row-span-2 row-start-1 h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:col-start-3 sm:row-span-1"
                    onClick={() => removeRow(index)}
                    title="Delete variable"
                    aria-label={`Delete ${row.key || 'variable'}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              {vars.length === 0 && (
                <div
                  onClick={addRow}
                  className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center transition-colors hover:border-muted-foreground/50 hover:bg-surface-muted/30 cursor-pointer"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3 text-sm font-semibold">No environment variables yet</h3>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    Click here to add your first variable, or paste{' '}
                    <code className="font-mono text-foreground">.env</code> contents directly.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4 gap-1.5 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      addRow();
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add variable
                  </Button>
                </div>
              )}
            </div>
          )}

          {hasChanges && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/60 p-4 animate-in fade-in-50">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="brand">Unsaved Changes</Badge>
                <span className="text-muted-foreground">
                  You have unsaved changes to your environment variables.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDiscard}
                  disabled={saving}
                  className="h-8 gap-1.5 text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="h-8 gap-1.5 text-xs"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Save changes
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 surface-card rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Next deployment required</p>
          <p>
            Environment variable updates are encrypted at rest and will automatically be supplied to
            your app during its next build and deployment.
          </p>
        </div>
      </div>
    </div>
  );
}
