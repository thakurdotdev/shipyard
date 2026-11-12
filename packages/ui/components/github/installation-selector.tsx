'use client';

import { Check, Plus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Github } from '@/components/icons';
import { cn } from '@/lib/utils';

export interface GitInstallation {
  id: number;
  account: {
    id: number;
    login: string;
    avatar_url?: string;
    type: string;
  };
}

interface InstallationSelectorProps {
  installations: GitInstallation[];
  selectedId: number | null;
  loading?: boolean;
  onSelect: (id: number) => void;
  onInstall: () => void;
}

export function InstallationSelector({
  installations,
  selectedId,
  loading,
  onSelect,
  onInstall,
}: InstallationSelectorProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-4">
            <div className="size-10 animate-pulse rounded-full bg-surface-muted" />
            <div className="h-3.5 w-24 animate-pulse rounded bg-surface-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (installations.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center animate-in fade-in duration-300">
        <span className="flex size-12 items-center justify-center rounded-full bg-surface-muted">
          <Github className="size-6" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-foreground">Connect GitHub to start</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Install the GitHub App on your account or organisation and pick which repositories it can
          see. You can change that later on GitHub.
        </p>
        <button
          type="button"
          onClick={onInstall}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Github className="size-4" /> Connect GitHub
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in fade-in duration-300">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Choose a GitHub account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Repositories come from the accounts where the GitHub App is installed.
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {installations.map((inst) => {
          const isSelected = selectedId === inst.id;
          const avatarUrl =
            inst.account.avatar_url ||
            `https://avatars.githubusercontent.com/u/${inst.account.id}?v=4`;

          return (
            <li key={inst.id}>
              <button
                type="button"
                onClick={() => onSelect(inst.id)}
                aria-pressed={isSelected}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]',
                  isSelected
                    ? 'border-brand-500/50 bg-brand-500/[0.06]'
                    : 'border-border bg-card hover:border-foreground/25 hover:bg-surface-muted/40',
                )}
              >
                <Avatar className="size-10 border border-border">
                  <AvatarImage src={avatarUrl} alt="" />
                  <AvatarFallback>{inst.account.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {inst.account.login}
                  </span>
                  <span className="block text-xs capitalize text-muted-foreground">
                    {inst.account.type === 'Organization' ? 'Organisation' : 'Personal account'}
                  </span>
                </span>
                {isSelected && (
                  <Check className="size-4 shrink-0 text-brand-800 dark:text-brand-300" />
                )}
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onInstall}
            className="flex h-full min-h-16 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" /> Add account or org
          </button>
        </li>
      </ul>
    </div>
  );
}
