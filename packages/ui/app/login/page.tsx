'use client';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { Check } from 'lucide-react';
import { useState } from 'react';

// The build, then the stages in deployment-pipeline.tsx.
const DEPLOY_STEPS = [
  { label: 'Build from GitHub', detail: 'Runs your build command' },
  { label: 'DNS setup', detail: 'Points your domain at the app' },
  { label: 'SSL certificate', detail: 'Serves it over HTTPS' },
  { label: 'Proxy config', detail: 'Routes traffic through Nginx' },
  { label: 'App start', detail: 'Starts your service' },
  { label: 'Health check', detail: 'Confirms it responds' },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  const handleGitHubLogin = async () => {
    setLoading(true);
    await authClient.signIn.social({
      provider: 'github',
      callbackURL: process.env.NEXT_PUBLIC_SITE_URL!, // Redirect to home after login
    });
    setLoading(false);
  };

  return (
    <div className="page-width grid min-h-[calc(100svh-4rem)] items-center gap-10 py-10 lg:grid-cols-2 lg:gap-16">
      <div className="mx-auto w-full max-w-sm lg:mx-0 lg:justify-self-end">
        <h1 className="page-heading">Sign in to Shipyard</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Deploy from GitHub, then manage domains, processes, and uptime from one dashboard.
        </p>
        <Button className="mt-7 h-11 w-full" onClick={handleGitHubLogin} disabled={loading}>
          <svg
            className="fill-current"
            aria-hidden="true"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          {loading ? 'Connecting...' : 'Continue with GitHub'}
        </Button>
      </div>

      <section
        aria-labelledby="deploy-steps-title"
        className="surface-card mx-auto w-full max-w-sm rounded-xl border border-console-border bg-console p-5 text-console-foreground sm:p-6 lg:mx-0 lg:max-w-md"
      >
        <h2 id="deploy-steps-title" className="text-sm font-medium">
          What happens when you deploy
        </h2>
        <ol className="mt-5 space-y-4">
          {DEPLOY_STEPS.map((step, index) => (
            <li
              key={step.label}
              className="deploy-step flex items-start gap-3"
              style={{ '--step': index } as React.CSSProperties}
            >
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
                <Check className="size-3" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm leading-5">{step.label}</span>
                <span className="block text-xs leading-5 text-console-foreground/65">
                  {step.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
