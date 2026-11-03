'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { Activity, FolderKanban, LogOut, Plus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeSwitcher } from './theme-switcher';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const projectRoute = pathname === '/' || pathname.startsWith('/projects');
  const isLogin = pathname === '/login';

  const navLinkClass = (active: boolean) =>
    cn(
      'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
      active
        ? 'bg-accent text-foreground'
        : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
    );

  return (
    <nav
      aria-label="Main navigation"
      className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className="page-width flex h-16 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4 sm:gap-7">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Image src="/logo.png" alt="" width={28} height={28} className="rounded-md" />
            <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
              Shipyard
            </span>
          </Link>

          {session && (
            <div className="flex items-center gap-1">
              <Link
                href="/"
                aria-label="Projects"
                className={navLinkClass(projectRoute)}
                aria-current={projectRoute ? 'page' : undefined}
              >
                <FolderKanban className="size-4" />
                <span className="hidden sm:inline">Projects</span>
              </Link>
              <Link
                href="/processes"
                aria-label="Processes"
                className={navLinkClass(pathname === '/processes')}
                aria-current={pathname === '/processes' ? 'page' : undefined}
              >
                <Activity className="size-4" />
                <span className="hidden sm:inline">Processes</span>
              </Link>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeSwitcher />
          {session ? (
            <>
              <Button asChild size="sm" className="h-9 gap-1.5 px-2.5 sm:px-3">
                <Link href="/projects/new" aria-label="Create project">
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">New project</span>
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    aria-label="Open account menu"
                    className="size-9 rounded-full border border-border bg-card p-0 hover:bg-accent"
                  >
                    <Avatar className="size-7">
                      <AvatarImage src={session.user.image || ''} alt={session.user.name} />
                      <AvatarFallback>{session.user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-60" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium leading-none">{session.user.name}</p>
                      <p className="truncate text-xs leading-none text-muted-foreground">
                        {session.user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      authClient.signOut({
                        fetchOptions: {
                          credentials: 'include',
                          onSuccess: () => router.push('/login'),
                        },
                      })
                    }
                  >
                    <LogOut className="mr-2 size-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : !isLogin ? (
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
