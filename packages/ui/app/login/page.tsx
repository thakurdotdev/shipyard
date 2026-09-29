'use client';

import { Button } from '@/components/ui/button';
import { CardShell } from '@/components/ui/card-shell';
import { authClient } from '@/lib/auth-client';
import { useState } from 'react';

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      {/* Editorial backdrop: grid + a very quiet brand wash. */}
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="glow-brand pointer-events-none absolute inset-x-0 top-0 h-[420px]"
      />

      <CardShell className="relative w-full max-w-sm" innerClassName="p-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-[-0.035em]">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to your account to continue</p>
        </div>

        <div className="space-y-4">
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={handleGitHubLogin}
            disabled={loading}
          >
            <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <title>GitHub</title>
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            {loading ? 'Connecting...' : 'Continue with GitHub'}
          </Button>
        </div>
      </CardShell>
    </div>
  );
}
