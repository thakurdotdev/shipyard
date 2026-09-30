'use client';

import { useEffect, useState } from 'react';
import { Activity, Loader2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { UptimeSettings } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

const intervals = [
  { value: '60', label: 'Every minute' },
  { value: '300', label: 'Every 5 minutes' },
  { value: '600', label: 'Every 10 minutes' },
  { value: '900', label: 'Every 15 minutes' },
  { value: '1800', label: 'Every 30 minutes' },
];

export function UptimeSettingsCard({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<UptimeSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [interval, setInterval] = useState('300');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await api.getUptimeSettings(projectId);
      setSettings(data);
      setEnabled(data.enabled);
      setEndpoint(data.endpoint_url || '');
      setInterval(String(data.interval_seconds));
    } catch (error) {
      console.error(error);
      toast.error('Failed to load uptime settings');
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const save = async () => {
    setSaving(true);
    try {
      const data = await api.updateUptimeSettings(projectId, {
        enabled,
        endpoint_url: endpoint.trim() || null,
        interval_seconds: Number(interval),
      });
      setSettings(data);
      toast.success('Uptime settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save uptime settings');
    } finally {
      setSaving(false);
    }
  };

  const statusColor =
    settings?.current_status === 'up'
      ? 'text-emerald-500'
      : settings?.current_status === 'down'
        ? 'text-red-500'
        : 'text-muted-foreground';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> Uptime Monitoring
            </CardTitle>
            <CardDescription>
              Check your deployed app on a schedule and get email alerts when it goes down or
              recovers.
            </CardDescription>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!settings || saving} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="uptime-endpoint">Endpoint URL</Label>
            <Input
              id="uptime-endpoint"
              type="url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="Automatic: deployed project domain"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to check the project domain after its deployment is active.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="uptime-interval">Check frequency</Label>
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger id="uptime-interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {intervals.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Email alerts go to your account email.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div>
            <p className="font-medium">
              Status: <span className={statusColor}>{settings?.current_status || 'Loading'}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {settings?.last_checked_at
                ? `Last checked ${new Date(settings.last_checked_at).toLocaleString()}`
                : 'No checks yet'}
            </p>
          </div>
          <Button onClick={save} disabled={!settings || saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save uptime settings
          </Button>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Recent checks</h4>
          {!settings?.history.length ? (
            <p className="text-sm text-muted-foreground">
              Checks will appear here after monitoring starts.
            </p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-md border">
              <div className="divide-y">
                {settings.history.map((check) => (
                  <div
                    key={check.id}
                    className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className={check.success ? 'text-emerald-500' : 'text-red-500'}>
                        {check.success ? 'Up' : 'Down'}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {check.status_code
                          ? `HTTP ${check.status_code}`
                          : check.error || 'Request failed'}
                      </span>
                    </div>
                    <div className="shrink-0 text-right text-muted-foreground">
                      {check.latency_ms === null ? '—' : `${check.latency_ms} ms`}
                      <span className="ml-3">{new Date(check.checked_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
