'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';

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
  onSelect: (id: number) => void;
  onInstall: () => void;
}

export function InstallationSelector({
  installations,
  selectedId,
  onSelect,
  onInstall,
}: InstallationSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          GitHub Account
        </h2>
        <Button variant="ghost" size="sm" onClick={onInstall} className="h-7">
          <Plus className="mr-1 size-4" /> Add Account
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {installations.map((inst) => {
          const isSelected = selectedId === inst.id;
          // Use provided avatar or fallback to constructed URL using ID
          const avatarUrl =
            inst.account.avatar_url ||
            `https://avatars.githubusercontent.com/u/${inst.account.id}?v=4`;

          return (
            <div
              key={inst.id}
              onClick={() => onSelect(inst.id)}
              className={cn(
                'group relative flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors duration-200',
                isSelected
                  ? 'border-border-strong bg-surface'
                  : 'border-border bg-surface-muted/40 hover:border-border-strong hover:bg-surface',
              )}
            >
              <Avatar className="size-10 border border-border">
                <AvatarImage src={avatarUrl} alt={inst.account.login} />
                <AvatarFallback>{inst.account.login.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>

              <div className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'truncate text-sm',
                    isSelected
                      ? 'font-medium text-foreground'
                      : 'text-foreground/80 group-hover:text-foreground',
                  )}
                >
                  {inst.account.login}
                </span>
                <span className="text-xs capitalize text-muted-foreground">
                  {inst.account.type}
                </span>
              </div>

              {isSelected && (
                <span className="absolute top-3 right-3 size-1.5 rounded-full bg-brand-500" />
              )}
            </div>
          );
        })}

        <button
          onClick={onInstall}
          className="flex h-[66px] items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-3 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:border-border-strong hover:bg-surface-muted/40 hover:text-foreground"
        >
          <span>Connect New</span>
        </button>
      </div>
    </div>
  );
}
