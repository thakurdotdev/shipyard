export function timeAgo(date: Date | string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + 'y ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + 'mo ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + 'd ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + 'h ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + 'm ago';
  return Math.max(0, seconds) + 's ago';
}

/** Elapsed time between two timestamps, or null if it can't be known. */
export function formatDuration(start: string, end: string | null | undefined): string | null {
  if (!end) return null;
  const seconds = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** How long a process has been up, given the time it started (epoch ms). */
export function formatUptime(startedAtMs: number): string {
  if (!startedAtMs) return '—';
  const diff = Date.now() - startedAtMs;
  if (diff < 0) return '—';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

/** Bytes as a short human size: 0 B, 912 KB, 173.6 MB, 22.4 GB. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : parseFloat(value.toFixed(value >= 100 ? 0 : 1))} ${units[i]}`;
}

/** The hostname of a stored domain, which may or may not carry a scheme or path. */
export function hostnameOf(domain: string | null | undefined): string | null {
  if (!domain) return null;
  try {
    return new URL(/^https?:\/\//.test(domain) ? domain : `https://${domain}`).hostname;
  } catch {
    return domain.replace(/^https?:\/\//, '').split(/[/:]/)[0] || null;
  }
}

/** Where a project's live site is reachable, if anywhere. */
export function siteUrl(project: { domain?: string | null; port?: number | null }): string | null {
  if (project.domain) {
    return /^https?:\/\//.test(project.domain) ? project.domain : `https://${project.domain}`;
  }
  return project.port ? `http://localhost:${project.port}` : null;
}

/** First line of a commit message. */
export function commitTitle(message: string | null | undefined): string | null {
  return message?.split('\n')[0].trim() || null;
}

/** A check interval in words: 30s, 5 min. */
export function formatInterval(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}

/** Calendar day heading for grouped lists: Today, Yesterday, or Nov 18. */
export function dayLabel(date: string | Date): string {
  const d = new Date(date);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}
