'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Facts, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusLabel, TONE_TEXT, type Tone } from '@/components/ui/status';
import { api } from '@/lib/api';
import { formatInterval, timeAgo } from '@/lib/format';
import { useUptime, type DomainProvision } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { CheckStrip } from './check-strip';

export function MonitoringPanel({ projectId }: { projectId: string }) {
  const { data: uptime, isLoading } = useUptime(projectId);
  const href = `/projects/${projectId}?tab=uptime`;

  const enabled = uptime?.enabled;
  const down = enabled && uptime.current_status === 'down';
  const tone: Tone = !enabled
    ? 'neutral'
    : down
      ? 'error'
      : uptime.current_status === 'up'
        ? 'success'
        : 'neutral';
  const label = !enabled
    ? 'Off'
    : down
      ? 'Down'
      : uptime.current_status === 'up'
        ? 'Up'
        : 'Waiting';

  return (
    <Panel>
      <PanelHeader
        title="Monitoring"
        actions={
          !isLoading && (
            <StatusLabel tone={tone} className="text-[13px]">
              {label}
            </StatusLabel>
          )
        }
      />
      <div className="px-4 py-4 sm:px-5">
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-surface-muted" />
        ) : !enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Get alerted when the site stops answering. Checks run from this server.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={href} scroll={false}>
                Set up monitoring
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {down && uptime.down_since && (
              <p className={cn('text-sm', TONE_TEXT.error)}>
                Down for {timeAgo(uptime.down_since).replace(' ago', '')}
              </p>
            )}
            <CheckStrip history={uptime.history} slots={36} compact />
            <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
              <span>
                <span className="text-foreground">
                  {uptime.summary?.uptime_percentage != null
                    ? `${uptime.summary.uptime_percentage}%`
                    : '—'}
                </span>{' '}
                {uptime.summary?.window_days ? `${uptime.summary.window_days}d` : 'uptime'}
              </span>
              <span>
                <span className="text-foreground">
                  {uptime.summary?.avg_latency_ms != null
                    ? `${uptime.summary.avg_latency_ms} ms`
                    : '—'}
                </span>{' '}
                avg
              </span>
              <span>every {formatInterval(uptime.interval_seconds)}</span>
            </p>
          </div>
        )}
      </div>
      {enabled && (
        <Link
          href={href}
          scroll={false}
          className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-surface-muted/40 hover:text-foreground sm:px-5"
        >
          Check history and settings
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </Panel>
  );
}

function provisionTone(status: string): Tone {
  if (['created', 'proxied', 'issued'].includes(status)) return 'success';
  if (status === 'failed') return 'error';
  if (['creating', 'issuing'].includes(status)) return 'progress';
  return 'neutral';
}

export function DomainPanel({
  projectId,
  domain,
  provision,
  onRefresh,
}: {
  projectId: string;
  domain: string | null;
  provision: DomainProvision | undefined;
  onRefresh: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const failed = provision?.dns_status === 'failed' || provision?.ssl_status === 'failed';
  const settingsHref = `/projects/${projectId}?tab=settings#domain`;

  const retry = async () => {
    setRetrying(true);
    try {
      await api.retryDomainProvision(projectId);
      toast.success('Retrying DNS and certificate setup');
      onRefresh();
    } catch (error) {
      toast.error('Retry failed', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRetrying(false);
    }
  };

  const expiry = provision?.ssl_expiry ? new Date(provision.ssl_expiry) : null;
  const daysLeft = expiry ? Math.round((expiry.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <Panel>
      <PanelHeader
        title="Domain"
        actions={
          failed ? (
            <Button variant="outline" size="sm" onClick={retry} disabled={retrying}>
              {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Retry
            </Button>
          ) : (
            <Link
              href={settingsHref}
              scroll={false}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Change
            </Link>
          )
        }
      />
      <div className="px-4 py-4 sm:px-5">
        {!domain ? (
          <p className="text-sm text-muted-foreground">
            No public domain.{' '}
            <Link
              href={settingsHref}
              scroll={false}
              className="text-foreground underline-offset-2 hover:underline"
            >
              Add one
            </Link>{' '}
            to put this app on the internet.
          </p>
        ) : !provision?.provisioned ? (
          <Facts
            items={[
              { label: 'Address', value: domain, mono: true },
              {
                label: 'DNS & SSL',
                value: <span className="text-muted-foreground">Set up on next deploy</span>,
              },
            ]}
          />
        ) : (
          <>
            <Facts
              items={[
                { label: 'Address', value: provision.full_domain ?? domain, mono: true },
                {
                  label: 'DNS',
                  value: (
                    <StatusLabel
                      tone={provisionTone(provision.dns_status)}
                      className="text-sm capitalize"
                    >
                      {provision.dns_status}
                    </StatusLabel>
                  ),
                },
                {
                  label: 'Certificate',
                  value: (
                    <StatusLabel
                      tone={provisionTone(provision.ssl_status)}
                      className="text-sm capitalize"
                    >
                      {provision.ssl_status}
                    </StatusLabel>
                  ),
                },
                ...(expiry && daysLeft !== null
                  ? [
                      {
                        label: 'Expires',
                        value: (
                          <span className={daysLeft < 14 ? TONE_TEXT.warning : undefined}>
                            in {daysLeft} days
                          </span>
                        ),
                        title: expiry.toLocaleDateString(),
                      },
                    ]
                  : []),
              ]}
            />
            {provision.error_message && (
              <p
                className={cn(
                  'mt-3 rounded-md border border-red-500/25 bg-red-500/5 p-2.5 text-xs',
                  TONE_TEXT.error,
                )}
              >
                {provision.error_message}
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
