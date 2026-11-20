import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GitCommit } from 'lucide-react';
import Link from 'next/link';

export function BuildList({ builds, projectId }: { builds: any[]; projectId: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Commit</TableHead>
          <TableHead>Created At</TableHead>
          <TableHead>Completed At</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {builds.map((build) => (
          <TableRow key={build.id}>
            <TableCell>
              <Badge
                variant={
                  build.status === 'success'
                    ? 'default'
                    : build.status === 'failed'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {build.status === 'cancelled' ? 'skipped' : build.status}
              </Badge>
            </TableCell>
            <TableCell>
              {build.commit_sha ? (
                <div className="flex items-center gap-2 text-sm">
                  <GitCommit className="w-3 h-3 text-muted-foreground" />
                  <span className="font-mono text-muted-foreground">
                    {build.commit_sha.slice(0, 7)}
                  </span>
                  {build.commit_message && (
                    <span
                      className="truncate max-w-[150px] text-muted-foreground"
                      title={build.commit_message}
                    >
                      {build.commit_message.split('\n')[0].slice(0, 40)}
                      {build.commit_message.length > 40 ? '...' : ''}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground italic">Manual</span>
              )}
            </TableCell>
            <TableCell>{new Date(build.created_at).toLocaleString()}</TableCell>
            <TableCell>
              {build.completed_at ? new Date(build.completed_at).toLocaleString() : '-'}
            </TableCell>
            <TableCell>
              <Button asChild variant="outline" size="sm">
                <Link href={`/projects/${projectId}/builds/${build.id}`}>View Logs</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
