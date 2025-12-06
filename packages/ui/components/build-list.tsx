import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function BuildList({
  builds,
  projectId,
}: {
  builds: any[];
  projectId: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
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
                  build.status === "success"
                    ? "default"
                    : build.status === "failed"
                    ? "destructive"
                    : "secondary"
                }
              >
                {build.status}
              </Badge>
            </TableCell>
            <TableCell>{new Date(build.created_at).toLocaleString()}</TableCell>
            <TableCell>
              {build.completed_at
                ? new Date(build.completed_at).toLocaleString()
                : "-"}
            </TableCell>
            <TableCell>
              <Button asChild variant="outline" size="sm">
                <Link href={`/projects/${projectId}/builds/${build.id}`}>
                  View Logs
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
