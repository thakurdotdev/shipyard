'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * A small stale-while-revalidate cache shared by every page.
 *
 * Data is kept per key for the life of the tab, so going back to a list or
 * switching project tabs renders the last known state instantly and refreshes
 * it in the background. Concurrent requests for one key share a single fetch.
 */

interface Snapshot<T = unknown> {
  data: T | undefined;
  error: Error | undefined;
  /** True once a fetch for this key has succeeded (data may legitimately be null). */
  loaded: boolean;
  validating: boolean;
}

interface Entry {
  snapshot: Snapshot;
  promise?: Promise<unknown>;
  fetchedAt: number;
  listeners: Set<() => void>;
}

const EMPTY: Snapshot = { data: undefined, error: undefined, loaded: false, validating: false };
const cache = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { snapshot: EMPTY, fetchedAt: 0, listeners: new Set() };
    cache.set(key, entry);
  }
  return entry;
}

function update(entry: Entry, patch: Partial<Snapshot>) {
  entry.snapshot = { ...entry.snapshot, ...patch };
  entry.listeners.forEach((listener) => listener());
}

/** Fetches a key, sharing any request already in flight. */
export function fetchQuery<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const entry = entryFor(key);
  if (entry.promise) return entry.promise as Promise<T>;
  update(entry, { validating: true });
  const promise = fetcher()
    .then(
      (data) => {
        entry.fetchedAt = Date.now();
        update(entry, { data, error: undefined, loaded: true, validating: false });
        return data;
      },
      (error: unknown) => {
        update(entry, {
          error: error instanceof Error ? error : new Error(String(error)),
          validating: false,
        });
        throw error;
      },
    )
    .finally(() => {
      entry.promise = undefined;
    });
  entry.promise = promise;
  return promise;
}

/** Writes a key locally, e.g. from a realtime event or after a successful mutation. */
export function setQueryData<T>(key: string, next: T | ((previous: T | undefined) => T)) {
  const entry = entryFor(key);
  const data =
    typeof next === 'function'
      ? (next as (previous: T | undefined) => T)(entry.snapshot.data as T | undefined)
      : next;
  update(entry, { data, error: undefined, loaded: true });
}

export interface QueryOptions {
  /** Poll while the tab is visible. */
  refreshInterval?: number;
  /** Cached data younger than this is not refetched on mount. */
  staleTime?: number;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: Error | undefined;
  /** Nothing to show yet: the first fetch hasn't finished. */
  isLoading: boolean;
  isValidating: boolean;
  refresh: () => Promise<T | undefined>;
  mutate: (next: T | ((previous: T | undefined) => T)) => void;
}

export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { refreshInterval, staleTime = 2000 }: QueryOptions = {},
): QueryResult<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => {};
      const entry = entryFor(key);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [key],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (key ? entryFor(key).snapshot : EMPTY),
    () => EMPTY,
  ) as Snapshot<T>;

  const refresh = useCallback(async () => {
    if (!key) return undefined;
    try {
      return await fetchQuery(key, () => fetcherRef.current());
    } catch {
      return undefined; // Surfaced through `error`.
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    if (Date.now() - entryFor(key).fetchedAt > staleTime) void refresh();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const timer = refreshInterval ? window.setInterval(refreshVisible, refreshInterval) : 0;
    return () => {
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      if (timer) window.clearInterval(timer);
    };
  }, [key, refresh, refreshInterval, staleTime]);

  const mutate = useCallback(
    (next: T | ((previous: T | undefined) => T)) => {
      if (key) setQueryData(key, next);
    },
    [key],
  );

  return {
    data: snapshot.data,
    error: snapshot.error,
    isLoading: !snapshot.loaded && !snapshot.error,
    isValidating: snapshot.validating,
    refresh,
    mutate,
  };
}
