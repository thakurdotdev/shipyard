'use client';

import { Github } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface GitInstallation {
  id: number;
  account: {
    login: string;
    avatar_url: string;
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
    <Card>
      <CardHeader>
        <CardTitle>GitHub Account</CardTitle>
      </CardHeader>
      <CardContent>
        {installations.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-muted-foreground mb-4">No GitHub App installations found.</p>
            <Button variant="outline" onClick={onInstall}>
              <Github className="mr-2 h-4 w-4" /> Install GitHub App
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {installations.map((inst) => (
              <div
                key={inst.id}
                className={cn(
                  'border p-4 rounded-lg cursor-pointer flex items-center gap-3 transition-colors',
                  selectedId === inst.id
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-gray-400 hover:bg-muted/50',
                )}
                onClick={() => onSelect(inst.id)}
              >
                <img
                  src={inst.account.avatar_url}
                  alt={inst.account.login}
                  className="w-8 h-8 rounded-full"
                />
                <span className="font-medium">{inst.account.login}</span>
              </div>
            ))}
            <Button variant="ghost" className="h-auto py-4 px-4" onClick={onInstall}>
              <Github className="mr-2 h-4 w-4" /> Add Another
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
