'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { platformApi, SetupStatus } from '@/lib/platform-api';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Github } from '@/components/icons';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

function SetupContent() {
  const params = useSearchParams();
  const connected = params.get('github') === 'connected';
  const returnedError = params.get('error');
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [token, setToken] = useState(params.get('token') ?? '');
  const [organization, setOrganization] = useState('');
  const [useOrganization, setUseOrganization] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(returnedError);

  useEffect(() => {
    platformApi
      .getSetupStatus()
      .then(setStatus)
      .catch((e) => setLoadError(e.message || 'Could not reach the ShipYard API'));
  }, []);

  const createApp = async () => {
    setWorking(true);
    setError(null);
    try {
      await platformApi.createGitHubApp({
        token: token.trim() || undefined,
        organization: useOrganization ? organization.trim() || undefined : undefined,
      });
      // The browser is now on its way to GitHub.
    } catch (e: any) {
      setError(e.message || 'Could not start GitHub App creation');
      setWorking(false);
    }
  };

  const signIn = async () => {
    setWorking(true);
    await authClient.signIn.social({
      provider: 'github',
      callbackURL: '/',
      errorCallbackURL: '/login',
    });
    setWorking(false);
  };

  if (loadError) {
    return (
      <Notice
        icon={<AlertTriangle className="size-5 text-amber-500" />}
        title="ShipYard API unreachable"
      >
        {loadError}. Check that the Control API is running (<code>pm0 ls</code>).
      </Notice>
    );
  }

  if (!status) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-5 animate-spin text-brand-500" />
      </div>
    );
  }

  if (connected || status.github_login_ready) {
    return (
      <Notice
        icon={<CheckCircle2 className="size-5 text-emerald-500" />}
        title={connected ? 'GitHub App created' : 'ShipYard is set up'}
      >
        <p>
          {status.signups_open
            ? 'Sign in with GitHub. The first account becomes the owner of this server.'
            : 'Sign in with the GitHub account that owns this server.'}
        </p>
        <Button className="mt-5 h-11 w-full" onClick={signIn} disabled={working}>
          <Github className="size-4" />
          {working ? 'Connecting...' : 'Sign in with GitHub'}
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          After signing in, install the App on the repositories you want to deploy from{' '}
          <Link href="/import" className="underline underline-offset-2">
            New project
          </Link>
          .
        </p>
      </Notice>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg py-12">
      <h1 className="page-heading">Set up ShipYard</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        ShipYard signs you in and reads your repositories through a GitHub App. Create one in a
        click: GitHub opens with everything filled in, you confirm, and you come back here.
      </p>

      <div className="surface-card mt-8 space-y-5 rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="space-y-2">
          <Label htmlFor="setup-token">Setup code</Label>
          <Input
            id="setup-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="From the installer output"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            The installer printed a setup link with this code. It proves you run this server.
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useOrganization}
              onChange={(e) => setUseOrganization(e.target.checked)}
              className="size-4 accent-current"
            />
            Create the App under a GitHub organization
          </label>
          {useOrganization && (
            <Input
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="Organization name, e.g. acme"
              aria-label="GitHub organization"
            />
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
          >
            {error}
          </p>
        )}

        <Button className="h-11 w-full" onClick={createApp} disabled={working || !token.trim()}>
          {working ? <Loader2 className="size-4 animate-spin" /> : <Github className="size-4" />}
          {working ? 'Opening GitHub...' : 'Create GitHub App'}
        </Button>
      </div>

      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        The App gets read access to code and metadata, and push events for automatic deploys. Apps
        will be served at <code>*.{status.base_domain}</code> from <code>{status.public_url}</code>.
      </p>
    </div>
  );
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md py-16">
      <div className="surface-card rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          {icon}
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <div className="mt-3 text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <div className="page-width">
      <Suspense>
        <SetupContent />
      </Suspense>
    </div>
  );
}
