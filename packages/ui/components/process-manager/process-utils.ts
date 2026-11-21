import type { Tone } from '@/components/ui/status';
import type { PM0Process } from '@/lib/pm0-api';

const STATUS: Record<string, { tone: Tone; label: string }> = {
  online: { tone: 'success', label: 'Online' },
  stopped: { tone: 'neutral', label: 'Stopped' },
  errored: { tone: 'error', label: 'Errored' },
  launching: { tone: 'progress', label: 'Starting' },
  stopping: { tone: 'warning', label: 'Stopping' },
  'waiting restart': { tone: 'progress', label: 'Restarting' },
};

export function processStatus(status: string): { tone: Tone; label: string } {
  return STATUS[status] ?? { tone: 'neutral', label: status };
}

/** Errored first, then anything mid-transition, running, and finally stopped. */
export function attentionRank(status: string): number {
  if (status === 'errored') return 0;
  if (status === 'online') return 2;
  if (status === 'stopped') return 3;
  return 1;
}

/** The command line in short form (script basename) and in full. */
export function processCommand(process: PM0Process): { short: string; full: string } {
  const interpreter =
    process.interpreter && process.interpreter !== 'none' ? `${process.interpreter} ` : '';
  const args = process.args?.length ? ` ${process.args.join(' ')}` : '';
  const script = process.script?.split('/').pop() || process.script || '—';
  return {
    short: `${interpreter}${script}${args}`,
    full: `${interpreter}${process.script ?? ''}${args}`.trim(),
  };
}

export function execModeLabel(mode: string): string {
  if (!mode) return 'Fork';
  const label = mode.replace(/_mode$/, '').replace(/-/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function restartsLabel(process: PM0Process): string {
  return process.max_restarts > 0
    ? `${process.restart_time}/${process.max_restarts}`
    : String(process.restart_time);
}

export function restartsExhausted(process: PM0Process): boolean {
  return process.max_restarts > 0 && process.restart_time >= process.max_restarts;
}
