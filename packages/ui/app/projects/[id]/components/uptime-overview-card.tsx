'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Activity, Clock3, ShieldCheck, ShieldX } from 'lucide-react';
import { api } from '@/lib/api';
import { UptimeSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function UptimeOverviewCard({
  projectId,
  onOpenSettings,
}: {
  projectId: string;
  onOpenSettings: () => void;
}) {
  const [settings, setSettings] = useState<UptimeSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getUptimeSettings(projectId)
      .then((result) => {
        if (!cancelled) setSettings(result);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const history = settings?.history ?? [];
  const successRate = history.length
    ? Math.round((history.filter((check) => check.success).length / history.length) * 100)
    : null;
  const status = settings?.enabled ? settings.current_status : 'disabled';
  const statusLabel =
    status === 'up' ? 'Operational' : status === 'down' ? 'Experiencing issues' : 'Monitoring off';
  const statusColor =
    status === 'up'
      ? 'text-emerald-400'
      : status === 'down'
        ? 'text-red-400'
        : 'text-muted-foreground';

  return (
    <Card className="flex h-full flex-col justify-between gap-5 border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Uptime monitoring</p>
          <p className={`mt-1.5 flex items-center gap-2 text-lg font-semibold ${statusColor}`}>
            {status === 'up' ? (
              <ShieldCheck className="h-5 w-5" />
            ) : status === 'down' ? (
              <ShieldX className="h-5 w-5" />
            ) : (
              <Activity className="h-5 w-5" />
            )}
            {statusLabel}
          </p>
        </div>
        <span className="rounded-lg border border-border bg-surface-muted p-2 text-muted-foreground">
          <Activity className="h-4 w-4" />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
        <div>
          <p className="text-xs text-muted-foreground">Recent success rate</p>
          <p className="mt-1 text-base font-semibold">
            {successRate === null ? '—' : `${successRate}%`}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Check interval</p>
          <p className="mt-1 flex items-center gap-1.5 text-base font-semibold">
            {settings?.enabled ? (
              <>
                <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                {settings.interval_seconds < 60
                  ? `${settings.interval_seconds}s`
                  : `${settings.interval_seconds / 60} min`}
              </>
            ) : (
              '—'
            )}
          </p>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 justify-between px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={onOpenSettings}
      >
        Configure monitor <ArrowRight className="h-4 w-4" />
      </Button>
    </Card>
  );
}
