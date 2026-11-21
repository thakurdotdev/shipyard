'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  Field,
  SaveFooter,
  SettingsSection,
  useUnsavedWarning,
} from '@/components/settings/settings-section';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Panel, PanelHeader } from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusLabel, TONE_TEXT, type Tone } from '@/components/ui/status';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { formatInterval, siteUrl, timeAgo } from '@/lib/format';
import { useUptime } from '@/lib/queries';
import type { Project, UptimeSettings } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CheckStrip } from './check-strip';

const CHECK_INTERVALS = [
  { value: '60', label: 'Every minute' },
  { value: '300', label: 'Every 5 minutes' },
  { value: '600', label: 'Every 10 minutes' },
  { value: '900', label: 'Every 15 minutes' },
  { value: '1800', label: 'Every 30 minutes' },
];

export function UptimeTab({ project }: { project: Project }) {
  const { data: settings, isLoading, isValidating, refresh, mutate, error } = useUptime(project.id);

  if (isLoading)
    return <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />;
  if (!settings) {
    return (
      <Panel>
        <EmptyState
          title="Couldn’t load monitoring"
          description={error?.message}
          action={
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      {settings.enabled && (
        <StatusPanel
          settings={settings}
          refreshing={isValidating}
          onRefresh={() => void refresh()}
        />
      )}
      {settings.enabled && settings.history.length > 0 && <ChecksPanel settings={settings} />}
      <MonitorSettings project={project} settings={settings} onSaved={mutate} />
    </div>
  );
}

function StatusPanel({
  settings,
  refreshing,
  onRefresh,
}: {
  settings: UptimeSettings;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const down = settings.current_status === 'down';
  const tone: Tone = down ? 'error' : settings.current_status === 'up' ? 'success' : 'neutral';
  const summary = settings.summary;
  const stats = [
    {
      label: summary?.window_days ? `Uptime, ${summary.window_days} days` : 'Uptime',
      value: summary?.uptime_percentage != null ? `${summary.uptime_percentage}%` : '—',
      sub: summary?.total_checks
        ? `${summary.successful_checks} of ${summary.total_checks} checks`
        : 'Awaiting checks',
    },
    {
      label: 'Average response',
      value: summary?.avg_latency_ms != null ? `${summary.avg_latency_ms} ms` : '—',
      sub: summary?.window_days ? `Over ${summary.window_days} days` : '',
    },
    {
      label: 'Checked',
      value: formatInterval(settings.interval_seconds),
      sub: settings.last_checked_at ? `Last ${timeAgo(settings.last_checked_at)}` : 'Not yet',
    },
  ];

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-3">
            <StatusLabel tone={tone} pulse={down} className="text-[15px] font-medium">
              {down
                ? 'Down'
                : settings.current_status === 'up'
                  ? 'Operational'
                  : 'Waiting for the first check'}
            </StatusLabel>
            {down && settings.down_since && (
              <span className={cn('text-xs font-normal', TONE_TEXT.error)}>
                for {timeAgo(settings.down_since).replace(' ago', '')} ·{' '}
                {settings.consecutive_failures} failed checks in a row
              </span>
            )}
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
            Refresh
          </Button>
        }
      />
      <dl className="grid grid-cols-3 border-b border-border">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 border-r border-border px-4 py-3.5 last:border-r-0 sm:px-5"
          >
            <dt className="truncate text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 font-mono text-lg leading-none font-medium tabular-nums">
              {stat.value}
            </dd>
            <dd className="mt-1.5 truncate text-xs text-muted-foreground">{stat.sub}</dd>
          </div>
        ))}
      </dl>
      {settings.history.length > 0 && (
        <div className="px-4 py-4 sm:px-5">
          <CheckStrip history={settings.history} />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>Older</span>
            <span>Latest</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ChecksPanel({ settings }: { settings: UptimeSettings }) {
  const [onlyFailures, setOnlyFailures] = useState(false);
  const failures = settings.history.filter((check) => !check.success).length;
  const rows = onlyFailures ? settings.history.filter((check) => !check.success) : settings.history;

  return (
    <Panel>
      <PanelHeader
        title="Recent checks"
        description={`The last ${settings.history.length}`}
        actions={
          failures > 0 && (
            <Button
              variant={onlyFailures ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={onlyFailures}
              onClick={() => setOnlyFailures((value) => !value)}
            >
              Failures only
              <span className="font-mono text-[11px] text-muted-foreground">{failures}</span>
            </Button>
          )
        }
      />
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-normal sm:px-5">Result</th>
              <th className="px-2 py-2 font-normal">Response</th>
              <th className="px-2 py-2 text-right font-normal">Latency</th>
              <th className="px-4 py-2 text-right font-normal sm:px-5">Checked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((check) => (
              <tr key={check.id} className={cn(!check.success && 'bg-red-500/[0.04]')}>
                <td className="px-4 py-2.5 sm:px-5">
                  <StatusLabel tone={check.success ? 'success' : 'error'} className="text-[13px]">
                    {check.success ? 'Up' : 'Down'}
                  </StatusLabel>
                </td>
                <td
                  className={cn(
                    'max-w-0 truncate px-2 py-2.5 font-mono text-xs',
                    !check.success && TONE_TEXT.error,
                  )}
                >
                  {check.status_code
                    ? `HTTP ${check.status_code}`
                    : check.error || 'Connection failed'}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">
                  {check.latency_ms !== null ? `${check.latency_ms} ms` : '—'}
                </td>
                <td
                  className="px-4 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground sm:px-5"
                  title={new Date(check.checked_at).toLocaleString()}
                >
                  {timeAgo(check.checked_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function MonitorSettings({
  project,
  settings,
  onSaved,
}: {
  project: Project;
  settings: UptimeSettings;
  onSaved: (settings: UptimeSettings) => void;
}) {
  const initial = () => ({
    enabled: settings.enabled,
    endpoint: settings.endpoint_url ?? '',
    interval: String(settings.interval_seconds),
  });
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  // Follow server changes (e.g. a refresh) while nothing is being edited.
  const savedKey = `${settings.enabled}|${settings.endpoint_url}|${settings.interval_seconds}`;
  const dirty =
    form.enabled !== settings.enabled ||
    form.endpoint.trim() !== (settings.endpoint_url ?? '') ||
    form.interval !== String(settings.interval_seconds);
  useEffect(() => {
    if (!dirty) setForm(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  useUnsavedWarning(dirty);

  const fallback = siteUrl(project) ?? 'the project’s domain';

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateUptimeSettings(project.id, {
        enabled: form.enabled,
        endpoint_url: form.endpoint.trim() || null,
        interval_seconds: Number(form.interval),
      });
      onSaved(updated);
      setForm({
        enabled: updated.enabled,
        endpoint: updated.endpoint_url ?? '',
        interval: String(updated.interval_seconds),
      });
      toast.success(updated.enabled ? 'Monitoring is on' : 'Monitoring is paused');
    } catch (error) {
      toast.error('Could not save monitoring', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id="monitor"
      title={settings.enabled ? 'Monitor settings' : 'Uptime monitoring'}
      description="This server requests the site on a schedule and alerts you when it stops answering, and again when it recovers."
      aside={
        <Switch
          aria-label="Uptime monitoring"
          checked={form.enabled}
          onCheckedChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))}
          disabled={saving}
        />
      }
      footer={
        <SaveFooter
          dirty={dirty}
          saving={saving}
          onSave={save}
          onReset={() => setForm(initial())}
          note={
            settings.enabled
              ? 'Alerts follow your notification preferences.'
              : 'Turn on to start checking.'
          }
        />
      }
    >
      {form.enabled && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <Field
            label="URL to check"
            htmlFor="uptime-endpoint"
            hint={
              <>
                Leave empty to check {fallback}. A health route such as{' '}
                <code className="font-mono">/api/health</code> catches more failures.
              </>
            }
          >
            <Input
              id="uptime-endpoint"
              type="url"
              value={form.endpoint}
              onChange={(event) => setForm((prev) => ({ ...prev, endpoint: event.target.value }))}
              placeholder={fallback}
              spellCheck={false}
              className="font-mono text-sm"
            />
          </Field>
          <Field label="Frequency" htmlFor="uptime-interval">
            <Select
              value={form.interval}
              onValueChange={(interval) => setForm((prev) => ({ ...prev, interval }))}
            >
              <SelectTrigger id="uptime-interval" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHECK_INTERVALS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}
    </SettingsSection>
  );
}
