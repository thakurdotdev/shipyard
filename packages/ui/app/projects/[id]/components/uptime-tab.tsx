'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Activity,
  Clock3,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Project, UptimeCheck, UptimeSettings } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface UptimeTabProps {
  project: Project;
}

const CHECK_INTERVALS = [
  { value: '60', label: 'Every minute' },
  { value: '300', label: 'Every 5 minutes' },
  { value: '600', label: 'Every 10 minutes' },
  { value: '900', label: 'Every 15 minutes' },
  { value: '1800', label: 'Every 30 minutes' },
];

export function UptimeTab({ project }: UptimeTabProps) {
  const [settings, setSettings] = useState<UptimeSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [interval, setInterval] = useState('300');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [isRefreshing, startTransition] = useTransition();

  const loadData = async (showLoadingState = false) => {
    if (showLoadingState) setLoading(true);
    try {
      const data = await api.getUptimeSettings(project.id);
      setSettings(data);
      setEnabled(data.enabled);
      setEndpoint(data.endpoint_url || '');
      setInterval(String(data.interval_seconds));
    } catch (err) {
      console.error(err);
      toast.error('Failed to load uptime settings');
    } finally {
      if (showLoadingState) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(true);
  }, [project.id]);

  const handleRefresh = () => {
    startTransition(async () => {
      await loadData(false);
      toast.success('Uptime status refreshed');
    });
  };

  const handleToggleEnabled = async (targetState?: boolean) => {
    if (!settings || togglingStatus) return;
    const nextState = targetState !== undefined ? targetState : !enabled;
    setTogglingStatus(true);
    try {
      const updated = await api.updateUptimeSettings(project.id, {
        enabled: nextState,
        endpoint_url: endpoint.trim() || null,
        interval_seconds: Number(interval),
      });
      setSettings(updated);
      setEnabled(updated.enabled);
      if (updated.enabled) {
        toast.success('Uptime monitoring is now active');
      } else {
        toast.info('Uptime monitoring paused');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to update monitoring state', {
        description: err.message || 'An unexpected error occurred',
      });
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const data = await api.updateUptimeSettings(project.id, {
        enabled,
        endpoint_url: endpoint.trim() || null,
        interval_seconds: Number(interval),
      });
      setSettings(data);
      toast.success('Uptime configuration saved');
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to save uptime settings', {
        description: err.message || 'An unexpected error occurred',
      });
    } finally {
      setSaving(false);
    }
  };

  const history = settings?.history ?? [];
  const summary = settings?.summary;

  const successRate =
    summary?.uptime_percentage !== undefined
      ? summary.uptime_percentage
      : history.length
        ? Math.round((history.filter((c) => c.success).length / history.length) * 100)
        : null;

  const avgLatency =
    summary?.avg_latency_ms !== undefined
      ? summary.avg_latency_ms
      : history.some((c) => c.success && c.latency_ms !== null)
        ? Math.round(
            history
              .filter((c) => c.success && c.latency_ms !== null)
              .reduce((acc, c) => acc + (c.latency_ms || 0), 0) /
              (history.filter((c) => c.success && c.latency_ms !== null).length || 1),
          )
        : null;

  const isUp = settings?.enabled && settings.current_status === 'up';
  const isDown = settings?.enabled && settings.current_status === 'down';

  const defaultMonitoredUrl = project.domain
    ? `https://${project.domain}`
    : project.port
      ? `http://localhost:${project.port}`
      : 'Deployed domain';

  const currentIntervalObj = CHECK_INTERVALS.find((i) => i.value === interval);
  const intervalLabel = currentIntervalObj
    ? currentIntervalObj.label.toLowerCase()
    : 'every 5 minutes';

  return (
    <div className="space-y-4 animate-in fade-in-50 duration-300">
      {/* Stat Cards Overview */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {/* Status */}
        <Card className="gap-2 border-border bg-card p-4 sm:p-5">
          <p className="text-xs text-muted-foreground">Current status</p>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                isUp ? 'bg-emerald-500' : isDown ? 'bg-destructive' : 'bg-muted-foreground',
              )}
            />
            <span className="text-lg font-semibold text-foreground">
              {isUp ? 'Operational' : isDown ? 'Service down' : 'Monitoring paused'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {settings?.last_checked_at
              ? `Last checked ${new Date(settings.last_checked_at).toLocaleTimeString()}`
              : 'No checks recorded yet'}
          </p>
        </Card>

        {/* Success rate */}
        <Card className="gap-2 border-border bg-card p-4 sm:p-5">
          <p className="text-xs text-muted-foreground">Success rate</p>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="text-lg font-semibold text-foreground">
              {successRate !== null ? `${successRate}%` : '—'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {summary && summary.total_checks > 0
              ? `Last ${summary.window_days} days (${summary.total_checks} checks)`
              : history.length > 0
                ? `Calculated from last ${history.length} checks`
                : 'Awaiting checks'}
          </p>
        </Card>

        {/* Response Latency */}
        <Card className="gap-2 border-border bg-card p-4 sm:p-5">
          <p className="text-xs text-muted-foreground">Avg latency</p>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-lg font-semibold text-foreground">
              {avgLatency !== null ? `${avgLatency} ms` : '—'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {summary && summary.total_checks > 0
              ? `Last ${summary.window_days} days average`
              : avgLatency !== null
                ? avgLatency < 250
                  ? 'Fast response time'
                  : 'Standard response time'
                : 'No latency metrics yet'}
          </p>
        </Card>

        {/* Check Interval */}
        <Card className="gap-2 border-border bg-card p-4 sm:p-5">
          <p className="text-xs text-muted-foreground">Check frequency</p>
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-lg font-semibold text-foreground">
              {settings?.enabled
                ? settings.interval_seconds < 60
                  ? `${settings.interval_seconds}s`
                  : `${settings.interval_seconds / 60} min`
                : 'Paused'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {settings?.enabled ? 'Automatic periodic ping' : 'Start monitoring to enable'}
          </p>
        </Card>
      </section>

      {/* Recent Checks History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <CardTitle>Recent checks</CardTitle>
              {history.length > 0 && (
                <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                  Last {history.length} checks
                </Badge>
              )}
            </div>
            <CardDescription className="mt-1">
              Log of latest response checks, latency measurements, and HTTP status codes.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex h-36 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
              <Activity className="h-8 w-8 text-muted-foreground/60" />
              <h4 className="mt-3 text-sm font-semibold">No check logs yet</h4>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Checks will automatically appear here once monitoring is active and the first
                interval passes.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <CheckStrip history={history} />
              <div className="max-h-[26rem] overflow-auto rounded-xl border border-border">
                <div className="sticky top-0 z-10 grid min-w-[560px] grid-cols-[100px_1fr_120px_180px] border-b border-border bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground">
                  <span>Status</span>
                  <span>Response / error</span>
                  <span className="text-right">Latency</span>
                  <span className="text-right">Checked at</span>
                </div>
                <div className="min-w-[560px] divide-y divide-border">
                  {history.map((check) => {
                    const isCheckUp = check.success;
                    const latency = check.latency_ms;

                    return (
                      <div
                        key={check.id}
                        className="grid grid-cols-[100px_1fr_120px_180px] items-center px-4 py-3 text-xs transition-colors hover:bg-surface-muted/30"
                      >
                        <div>
                          {isCheckUp ? (
                            <Badge
                              variant="outline"
                              className="gap-1.5 font-mono text-xs font-normal"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> UP
                            </Badge>
                          ) : (
                            <Badge
                              variant="destructive"
                              className="gap-1.5 font-mono text-xs font-normal"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground" />{' '}
                              DOWN
                            </Badge>
                          )}
                        </div>

                        <div className="truncate pr-4 font-mono">
                          {check.status_code ? (
                            <span
                              className={
                                check.status_code < 400 ? 'text-foreground' : 'text-destructive'
                              }
                            >
                              HTTP {check.status_code}
                            </span>
                          ) : (
                            <span className="text-destructive">
                              {check.error || 'Connection Failed'}
                            </span>
                          )}
                        </div>

                        <div className="text-right font-mono text-foreground">
                          {latency !== null ? (
                            <span>{latency} ms</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>

                        <div className="text-right text-muted-foreground">
                          {new Date(check.checked_at).toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monitoring Configuration */}
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground">
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>Monitor settings</CardTitle>
              <CardDescription className="mt-1">
                Configure destination endpoint, check intervals, and operational state.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Theme-Consistent State Row */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-muted/40 p-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Monitoring</span>
                <Badge
                  variant={enabled ? 'outline' : 'secondary'}
                  className="gap-1.5 text-xs font-normal"
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      enabled ? 'bg-emerald-500' : 'bg-muted-foreground/60',
                    )}
                  />
                  {enabled ? 'Active' : 'Paused'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Toggle automatic background health checks on or off at any time.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={enabled}
                onCheckedChange={(val) => handleToggleEnabled(val)}
                disabled={!settings || togglingStatus}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="uptime-tab-endpoint">Monitored endpoint URL</Label>
              <Input
                id="uptime-tab-endpoint"
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={`Automatic: ${defaultMonitoredUrl}`}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to automatically monitor your project domain, or specify a custom path
                (e.g. <code className="font-mono text-foreground">/api/health</code>).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="uptime-tab-interval">Check frequency</Label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger id="uptime-tab-interval" className="w-full">
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
              <p className="text-xs text-muted-foreground">
                Email alerts will automatically be sent to your account email when status changes.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSaveConfig} disabled={!settings || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const STRIP_SLOTS = 60;

/** One mark per check, oldest to newest. Failures are also taller, so they don't rely on colour. */
function CheckStrip({ history }: { history: UptimeCheck[] }) {
  const [hovered, setHovered] = useState<UptimeCheck | null>(null);
  const checks = history.slice(0, STRIP_SLOTS).reverse();
  const passed = checks.filter((check) => check.success).length;
  const failed = checks.length - passed;

  return (
    <div>
      <p className="mb-2.5 min-h-5 truncate text-xs text-muted-foreground" aria-live="off">
        {hovered ? (
          <>
            <span className="font-medium text-foreground">
              {hovered.success
                ? 'Passed'
                : hovered.error || (hovered.status_code ? 'Failed' : 'Connection failed')}
            </span>
            {hovered.status_code ? ` · HTTP ${hovered.status_code}` : ''}
            {hovered.latency_ms !== null ? ` · ${hovered.latency_ms} ms` : ''}
            {` · ${new Date(hovered.checked_at).toLocaleString()}`}
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">
              {passed} of {checks.length} passed
            </span>
            {failed > 0 ? ` · ${failed} failed` : ''}
          </>
        )}
      </p>
      <div
        role="img"
        aria-label={`${passed} of the last ${checks.length} checks passed, ${failed} failed`}
        className="flex h-8 items-end gap-0.5"
        onMouseLeave={() => setHovered(null)}
      >
        {Array.from({ length: STRIP_SLOTS - checks.length }, (_, index) => (
          <div key={index} className="h-1 min-w-0 flex-1 rounded-[2px] bg-border" />
        ))}
        {checks.map((check) => (
          <div
            key={check.id}
            className="flex h-full min-w-0 flex-1 items-end"
            onMouseEnter={() => setHovered(check)}
          >
            <div
              className={cn(
                'w-full rounded-[2px] transition-opacity',
                check.success
                  ? 'h-3/5 bg-emerald-600/80 dark:bg-emerald-500/70'
                  : 'h-full bg-red-500',
                hovered && hovered.id !== check.id && 'opacity-40',
              )}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>Older</span>
        <span>Latest</span>
      </div>
    </div>
  );
}
