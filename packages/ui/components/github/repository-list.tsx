'use client';

import { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface GitRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
}

interface RepositoryListProps {
  repositories: GitRepository[];
  loading: boolean;
  onSelect: (repo: GitRepository) => void;
}

export function RepositoryList({ repositories, loading, onSelect }: RepositoryListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRepos = repositories.filter((r) =>
    r.full_name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Repository</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search repositories..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
            {filteredRepos.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No repositories found.</div>
            ) : (
              filteredRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="flex justify-between items-center p-3 hover:bg-muted/50 rounded-md border cursor-pointer transition-colors"
                  onClick={() => onSelect(repo)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{repo.full_name}</span>
                    {repo.private && (
                      <Badge variant="secondary" className="text-xs">
                        Private
                      </Badge>
                    )}
                  </div>
                  <Button size="sm" variant="ghost">
                    Import
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
