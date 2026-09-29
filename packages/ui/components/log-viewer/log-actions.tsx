'use client';

import { Button } from '@/components/ui/button';
import { Copy, Download, Trash2, Search, Loader2, RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface LogActionsProps {
  onCopy: () => void;
  onDownload: () => void;
  onClear: () => void;
  onOpenSearch: () => void;
  onRefresh: () => void;
  isClearing: boolean;
  isRefreshing: boolean;
  disabled: boolean;
}

export function LogActions({
  onCopy,
  onDownload,
  onClear,
  onOpenSearch,
  onRefresh,
  isClearing,
  isRefreshing,
  disabled,
}: LogActionsProps) {
  return (
    <div className="flex items-center gap-0.5 sm:gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-console-muted hover:text-console-foreground hover:bg-console-surface"
        onClick={onOpenSearch}
        title="Find in logs (⌘F)"
      >
        <Search className="w-4 h-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-console-muted hover:text-console-foreground hover:bg-console-surface"
        onClick={onRefresh}
        title="Refresh logs"
        disabled={isRefreshing}
      >
        {isRefreshing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-console-muted hover:text-console-foreground hover:bg-console-surface"
        onClick={onCopy}
        title="Copy logs"
        disabled={disabled}
      >
        <Copy className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-console-muted hover:text-console-foreground hover:bg-console-surface"
        onClick={onDownload}
        title="Download logs"
        disabled={disabled}
      >
        <Download className="w-4 h-4" />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-console-muted hover:text-red-400 hover:bg-console-surface"
            title="Clear logs"
            disabled={disabled || isClearing}
          >
            {isClearing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Build Logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all logs for this build.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onClear}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear Logs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
