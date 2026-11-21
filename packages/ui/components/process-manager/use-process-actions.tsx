'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { pm0Api, processTarget, type PM0Process } from '@/lib/pm0-api';
import { queryKeys } from '@/lib/queries';
import { fetchQuery } from '@/lib/use-query';

export type ProcessAction = 'start' | 'restart' | 'reload' | 'stop' | 'delete';

/** Refetch the shared PM0 listing after something changed. */
export function refreshProcesses() {
  return fetchQuery(queryKeys.processes, () => pm0Api.getProcessesWithSystem()).catch(
    () => undefined,
  );
}

const DONE: Record<ProcessAction, string> = {
  start: 'Started',
  restart: 'Restarted',
  reload: 'Reloaded',
  stop: 'Stopped',
  delete: 'Deleted',
};

/**
 * Runs process actions with consistent feedback. Stop and delete take a
 * service down, so they ask first; render `dialog` once wherever this is used.
 */
export function useProcessActions({ onDone }: { onDone?: (action: ProcessAction) => void } = {}) {
  const [pending, setPending] = useState<{ action: ProcessAction; target: string } | null>(null);
  const [confirm, setConfirm] = useState<{ action: 'stop' | 'delete'; process: PM0Process } | null>(
    null,
  );

  const run = async (action: ProcessAction, process: PM0Process) => {
    const target = processTarget(process);
    setPending({ action, target });
    try {
      if (action === 'stop') await pm0Api.stopProcess(target);
      else if (action === 'reload') await pm0Api.reloadProcess(target);
      else if (action === 'delete') await pm0Api.deleteProcess(target);
      else await pm0Api.restartProcess(target); // Starting a stopped process is a restart.
      toast.success(`${DONE[action]} ${process.name}`);
      await refreshProcesses();
      onDone?.(action);
    } catch (err) {
      toast.error(`Could not ${action} ${process.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPending(null);
    }
  };

  const request = (action: ProcessAction, process: PM0Process) => {
    if (action === 'stop' || action === 'delete') setConfirm({ action, process });
    else void run(action, process);
  };

  const isPending = (process: PM0Process, action?: ProcessAction) =>
    !!pending &&
    pending.target === processTarget(process) &&
    (action === undefined || pending.action === action);

  const platform = confirm?.process.daemon === 'platform';
  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirm?.action === 'delete' ? 'Delete' : 'Stop'} {confirm?.process.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm?.action === 'delete'
              ? 'It stops and is removed from PM0. Deploying its project again recreates it.'
              : 'Anything it serves is unavailable until you start it again.'}
            {platform &&
              ' This is one of Shipyard’s own services; the dashboard may stop responding.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (confirm) void run(confirm.action, confirm.process);
              setConfirm(null);
            }}
          >
            {confirm?.action === 'delete' ? 'Delete process' : 'Stop process'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { request, isPending, busy: pending !== null, dialog };
}
