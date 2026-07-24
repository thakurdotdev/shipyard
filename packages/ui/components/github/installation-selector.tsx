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
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
          GitHub Account
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onInstall}
          className="text-zinc-400 hover:text-white h-7"
        >
          <Plus className="w-4 h-4 mr-1" /> Add Account
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
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
                'group relative flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200',
                isSelected
                  ? 'bg-zinc-800/80 border-zinc-600 ring-1 ring-zinc-500'
                  : 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700',
              )}
            >
              <Avatar className="w-10 h-10 border border-zinc-800">
                <AvatarImage src={avatarUrl} alt={inst.account.login} />
                <AvatarFallback>{inst.account.login.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>

              <div className="flex flex-col min-w-0">
                <span
                  className={cn(
                    'font-medium text-sm truncate',
                    isSelected ? 'text-white' : 'text-zinc-300 group-hover:text-white',
                  )}
                >
                  {inst.account.login}
                </span>
                <span className="text-xs text-zinc-500 capitalize">{inst.account.type}</span>
              </div>

              {isSelected && (
                <div className="absolute right-3 top-3 w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
              )}
            </div>
          );
        })}

        <button
          onClick={onInstall}
          className="flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900/40 transition-all duration-200 h-[66px]"
        >
          <span className="text-sm font-medium">Connect New</span>
        </button>
      </div>
    </div>
  );
}
