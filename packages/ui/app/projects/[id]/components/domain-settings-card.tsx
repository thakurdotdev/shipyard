'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  CirclePlus,
  ExternalLink,
  Globe,
  Loader2,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { DomainCheck, DomainHostCheck, DomainSwitch, Project } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface DomainSettingsCardProps {
  project: Project;
  /** Called once a domain change has finished, so the page can reload the project. */
  onDomainChange?: () => void;
}

function HostLine({ host }: { host: DomainHostCheck }) {
  const icon =
    host.status === 'ours' ? (
      <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
    ) : host.status === 'missing' ? (
      <CirclePlus className="size-4 shrink-0 text-muted-foreground" />
    ) : (
      <CircleAlert className="size-4 shrink-0 text-red-600 dark:text-red-400" />
    );
  const text =
    host.status === 'ours'
      ? `already points here${host.proxied ? ' (Cloudflare proxied)' : ''}; kept as is`
      : host.status === 'missing'
        ? 'a DNS record will be created'
        : host.status === 'elsewhere'
          ? `points elsewhere: ${host.detail}`
          : 'DNS not checked';
  return (
    <li className="flex items-start gap-2 text-sm">
      {icon}
      <span className="min-w-0">
        <span className="font-mono text-[13px]">{host.name}</span>{' '}
        <span className="text-muted-foreground">{text}</span>
      </span>
    </li>
  );
}

export function DomainSettingsCard({ project, onDomainChange }: DomainSettingsCardProps) {
  const [domain, setDomain] = useState(project.domain ?? '');
  const [www, setWww] = useState(Boolean(project.www_redirect));
  const [check, setCheck] = useState<DomainCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState<DomainSwitch | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A ref, so a re-render of the page doesn't restart polling.
  const onDomainChangeRef = useRef(onDomainChange);
  onDomainChangeRef.current = onDomainChange;

  const running = progress?.state === 'running';
  const checkedInput = check && check.domain && domain.trim() ? check : null;
  const unchanged =
    checkedInput?.domain === project.domain?.toLowerCase() &&
    checkedInput?.www_redirect === Boolean(project.www_redirect);

  const poll = useCallback(async () => {
    const state = await api.getDomainSwitch(project.id).catch(() => null);
    setProgress(state);
    if (state?.state === 'running') {
      pollRef.current = setTimeout(poll, 2000);
      return;
    }
    if (state?.state === 'done') {
      toast.success(state.message);
      setCheck(null);
      onDomainChangeRef.current?.();
    } else if (state?.state === 'failed') {
      toast.error('Domain not changed', { description: state.message });
    }
  }, [project.id]);

  // Pick up a change that is still running (e.g. after a page reload).
  useEffect(() => {
    let cancelled = false;
    api
      .getDomainSwitch(project.id)
      .then((state) => {
        if (cancelled || !state) return;
        setProgress(state);
        if (state.state === 'running') pollRef.current = setTimeout(poll, 2000);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [project.id, poll]);

  useEffect(() => {
    setDomain(project.domain ?? '');
    setWww(Boolean(project.www_redirect));
  }, [project.domain, project.www_redirect]);

  const runCheck = async () => {
    if (!domain.trim()) return;
    setChecking(true);
    try {
      setCheck(await api.checkProjectDomain(project.id, domain.trim(), www));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not check the domain');
    } finally {
      setChecking(false);
    }
  };

  const startChange = async () => {
    if (!checkedInput) return;
    setStarting(true);
    try {
      const result = await api.changeProjectDomain(project.id, checkedInput.domain, www);
      if (!result.started) {
        toast.info('Nothing to change');
        return;
      }
      setProgress({
        state: 'running',
        domain: checkedInput.domain,
        www_redirect: checkedInput.www_redirect,
        previous_domain: project.domain,
        message: `Moving to ${checkedInput.domain}...`,
        started_at: new Date().toISOString(),
      });
      pollRef.current = setTimeout(poll, 1500);
    } catch (e) {
      toast.error('Domain not changed', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Domain
        </CardTitle>
        <CardDescription>
          A subdomain (just the name, like <span className="font-mono">portfolio</span>) or any
          domain in your Cloudflare account, including a root domain like{' '}
          <span className="font-mono">example.com</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {project.domain && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            Live at
            <a
              href={`https://${project.domain}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[13px] text-foreground hover:underline"
            >
              {project.domain}
              <ExternalLink className="size-3.5" />
            </a>
            {project.www_redirect && (
              <span>
                (and <span className="font-mono text-[13px]">www.{project.domain}</span>)
              </span>
            )}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="project-domain">Domain</Label>
            <Input
              id="project-domain"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setCheck(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && runCheck()}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              disabled={running}
              className="font-mono"
            />
          </div>
          <Button
            variant="outline"
            onClick={runCheck}
            disabled={checking || running || !domain.trim()}
            className="gap-1.5"
          >
            {checking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Check
          </Button>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            id="www-redirect"
            checked={www}
            onCheckedChange={(value) => {
              setWww(value);
              setCheck(null);
            }}
            disabled={running}
          />
          <div className="space-y-0.5">
            <Label htmlFor="www-redirect">Redirect www</Label>
            <p className="text-xs text-muted-foreground">
              Custom domains only: www.{'<domain>'} sends visitors to the domain itself.
            </p>
          </div>
        </div>

        {checkedInput && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <ul className="space-y-1.5">
              {checkedInput.hosts.map((host) => (
                <HostLine key={host.name} host={host} />
              ))}
            </ul>
            {checkedInput.zone && (
              <p className="text-xs text-muted-foreground">
                Cloudflare zone: <span className="font-mono">{checkedInput.zone}</span>
              </p>
            )}
            {checkedInput.warnings.map((warning) => (
              <p
                key={warning}
                className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-700 dark:text-amber-400"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {warning}
              </p>
            ))}
            {checkedInput.errors.map((error) => (
              <p
                key={error}
                className="flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs leading-5 text-red-700 dark:text-red-400"
              >
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            ))}
            {checkedInput.errors.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {unchanged
                    ? 'This is the current setting.'
                    : 'The current domain keeps serving until the new one answers; if anything fails, nothing changes.'}
                </p>
                <Button
                  onClick={startChange}
                  disabled={starting || running || unchanged}
                  className="gap-1.5"
                >
                  {starting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                  Move to {checkedInput.domain}
                </Button>
              </div>
            )}
          </div>
        )}

        {progress && (progress.state === 'running' || progress.state === 'failed') && (
          <div
            role="status"
            className={
              progress.state === 'running'
                ? 'flex items-center gap-2 rounded-lg border border-border bg-surface-muted p-3 text-sm'
                : 'flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400'
            }
          >
            {progress.state === 'running' ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {progress.state === 'running'
                ? `${progress.message} DNS, certificate and site switch can take a minute.`
                : progress.message}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
