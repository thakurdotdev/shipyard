'use client';

import { useCallback, useState } from 'react';

/**
 * State mirrored into a query parameter, so filters survive a reload and the
 * back button. Default values are left out of the URL to keep it clean.
 */
export function useUrlState<T extends string = string>(
  key: string,
  defaultValue: NoInfer<T>,
  allowed?: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    const raw = new URLSearchParams(window.location.search).get(key) as T | null;
    if (raw === null || (allowed && !allowed.includes(raw))) return defaultValue;
    return raw;
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      const url = new URL(window.location.href);
      if (next === defaultValue || next === '') url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      // Keep Next's router state; only the query string changes.
      window.history.replaceState(window.history.state, '', url);
    },
    [key, defaultValue],
  );

  return [value, update];
}
