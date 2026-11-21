'use client';

import { useState } from 'react';
import { FrameworkIcon } from '@/components/ui/framework-icons';
import { hostnameOf } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The site's favicon when it has a domain, else the framework's mark. */
export function ProjectAvatar({
  domain,
  appType,
  size = 'md',
  className,
}: {
  domain: string | null | undefined;
  appType: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const host = hostnameOf(domain);
  const src = host && !failed ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-surface-muted',
        size === 'lg' ? 'size-11' : 'size-8',
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          className={size === 'lg' ? 'size-6' : 'size-4'}
          onError={() => setFailed(true)}
        />
      ) : (
        <FrameworkIcon icon={appType} size={size === 'lg' ? 22 : 16} className="text-foreground" />
      )}
    </span>
  );
}
