'use client';

import { authClient } from '@/lib/auth-client';
import { Loader2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  // /setup works before any account exists (it is how the first one gets created).
  const isPublicRoute = pathname === '/login' || pathname === '/setup';

  useEffect(() => {
    if (!isPublicRoute && !isPending && !session) {
      router.push('/login');
    }
  }, [session, isPending, router, isPublicRoute]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (isPending) {
    return (
      <div className="flex min-h-svh w-full flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="size-5 animate-spin text-brand-500" />
        <p className="text-sm text-muted-foreground">Loading workspace</p>
      </div>
    );
  }

  if (!session) {
    return null; // Render nothing while redirecting
  }

  return <>{children}</>;
}
