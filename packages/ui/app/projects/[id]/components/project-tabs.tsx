'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export const PROJECT_TABS = [
  'overview',
  'deployments',
  'logs',
  'environment',
  'uptime',
  'settings',
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

const LABELS: Record<ProjectTab, string> = {
  overview: 'Overview',
  deployments: 'Deployments',
  logs: 'Logs',
  environment: 'Environment',
  // The URL keeps "uptime" so existing links still work.
  uptime: 'Monitoring',
  settings: 'Settings',
};

/** Underlined section links. Sticks under the top bar and scrolls sideways on phones. */
export function ProjectTabs({
  projectId,
  current,
  buildCount,
}: {
  projectId: string;
  current: ProjectTab;
  buildCount: number;
}) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // Bring the active tab into view inside the strip without scrolling the page.
    const tab = activeRef.current;
    const strip = tab?.parentElement;
    if (!tab || !strip) return;
    const overflowRight = tab.offsetLeft + tab.offsetWidth - (strip.scrollLeft + strip.clientWidth);
    if (overflowRight > 0) strip.scrollLeft += overflowRight + 24;
    else if (tab.offsetLeft < strip.scrollLeft) strip.scrollLeft = tab.offsetLeft - 24;
  }, [current]);

  return (
    <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-30 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <nav
        aria-label="Project sections"
        className="page-width no-scrollbar relative flex gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:[mask-image:none]"
      >
        {PROJECT_TABS.map((tab) => {
          const active = tab === current;
          return (
            <Link
              key={tab}
              ref={active ? activeRef : undefined}
              href={`/projects/${projectId}${tab === 'overview' ? '' : `?tab=${tab}`}`}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative inline-flex h-11 shrink-0 items-center gap-1.5 px-2.5 text-sm transition-colors outline-none first:-ml-2.5 focus-visible:text-foreground',
                'after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full',
                active
                  ? 'font-medium text-foreground after:bg-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {LABELS[tab]}
              {tab === 'deployments' && buildCount > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {buildCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
