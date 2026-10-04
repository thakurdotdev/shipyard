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
import { Activity, FolderGit2, LogOut } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeSwitcher } from './theme-switcher';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  const routes = [
    {
      href: '/processes',
      label: 'Processes',
      icon: Activity,
      active: pathname === '/processes',
    },
    {
      href: '/projects/new',
      label: 'New Project',
      icon: FolderGit2,
      active: pathname === '/projects/new',
    },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-3 sm:px-6">
        <div className="flex items-center gap-2.5 sm:gap-7 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 text-[15px] font-bold tracking-tight shrink-0"
          >
            <Image
              src="/logo.png"
              alt="Logo"
              width={28}
              height={28}
              className="rounded-lg shrink-0"
            />
            <span className="hidden min-[380px]:inline">ShipYard</span>
          </Link>
          {session && (
            <div className="flex items-center gap-1 sm:gap-6">
              {routes.map((route) => {
                const isProcesses = route.href === '/processes';
                return (
                  <Link
                    key={route.href}
                    href={route.href}
                    className={cn(
                      'flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm transition-colors duration-200 py-1.5 px-2.5 sm:px-0 sm:py-0 rounded-md shrink-0',
                      route.active
                        ? 'font-medium text-foreground bg-surface-muted sm:bg-transparent'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-muted/50 sm:hover:bg-transparent',
                      !isProcesses && 'hidden sm:flex',
                    )}
                  >
                    <route.icon className="size-4 shrink-0" />
                    <span>{route.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <ThemeSwitcher />
          {session ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative size-9 rounded-xl border border-border bg-surface-muted p-0 hover:border-border-strong hover:bg-surface-muted/70"
                >
                  <Avatar className="size-7">
                    <AvatarImage src={session.user.image || ''} alt={session.user.name} />
                    <AvatarFallback>{session.user.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{session.user.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {session.user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="sm:hidden" />
                <DropdownMenuItem asChild className="sm:hidden">
                  <Link href="/processes" className="flex items-center">
                    <Activity className="mr-2 h-4 w-4" />
                    <span>Processes</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="sm:hidden">
                  <Link href="/projects/new" className="flex items-center">
                    <FolderGit2 className="mr-2 h-4 w-4" />
                    <span>New Project</span>
                  </Link>
                </DropdownMenuItem>
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
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild>
              <Link href="/login">Sign In</Link>
            </Button>
          )}
        </div>
      </div>
    </nav>
  );
}
