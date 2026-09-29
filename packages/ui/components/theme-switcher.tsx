'use client';

import { MonitorIcon, MoonStarIcon, SunIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTheme } from 'next-themes';
import type { JSX } from 'react';
import { useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';

const SPRING = { type: 'spring' as const, bounce: 0.3, duration: 0.6 };

function ThemeOption({
  icon,
  value,
  isActive,
  onClick,
}: {
  icon: JSX.Element;
  value: string;
  isActive?: boolean;
  onClick: (value: string) => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <button
      className={cn(
        'relative flex size-8 cursor-pointer items-center justify-center rounded-lg transition-[color] duration-200 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] [&_svg]:size-4',
        isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
      role="radio"
      aria-checked={isActive}
      aria-label={`Switch to ${value} theme`}
      onClick={() => onClick(value)}
    >
      <span className="relative z-10 flex">{icon}</span>

      {isActive && (
        <motion.div
          layoutId="theme-option"
          transition={reduceMotion ? { duration: 0 } : SPRING}
          className="absolute inset-0 rounded-lg border border-border-strong bg-surface shadow-xs"
        />
      )}
    </button>
  );
}

const THEME_OPTIONS = [
  {
    icon: <MonitorIcon />,
    value: 'system',
  },
  {
    icon: <SunIcon />,
    value: 'light',
  },
  {
    icon: <MoonStarIcon />,
    value: 'dark',
  },
];

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion();

  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!isMounted) {
    // Reserve the same footprint the control will take, so the bar never jumps.
    return <div className="h-[38px] w-[106px]" />;
  }

  return (
    <motion.div
      key={String(isMounted)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.3 }}
      className="inline-flex items-center gap-0.5 overflow-hidden rounded-xl border border-border bg-surface-muted p-0.5"
      role="radiogroup"
    >
      {THEME_OPTIONS.map((option) => (
        <ThemeOption
          key={option.value}
          icon={option.icon}
          value={option.value}
          isActive={theme === option.value}
          onClick={setTheme}
        />
      ))}
    </motion.div>
  );
}

export { ThemeSwitcher };
