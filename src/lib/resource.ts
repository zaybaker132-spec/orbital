import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";

/**
 * Minimal cached data layer: keyed GET resources with prefix invalidation.
 * Live server events invalidate the relevant keys so views stay current.
 */
type Entry = { data?: unknown; error?: Error; promise?: Promise<unknown>; at: number };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version++; listeners.forEach((l) => l()); };

export function invalidate(...prefixes: string[]) {
  for (const k of cache.keys()) if (prefixes.some((p) => k.startsWith(p))) cache.delete(k);
  notify();
}

export function setCached(key: string, data: unknown) {
  cache.set(key, { data, at: Date.now() });
  notify();
}

export function useResource<T = any>(key: string | null) {
  const v = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version);
  const [, force] = useState(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const entry = key ? cache.get(key) : undefined;
  useEffect(() => {
    if (!key) return;
    const e = cache.get(key);
    if (e && (e.data !== undefined || e.error || e.promise)) return;
    const promise = api.get<T>(key).then(
      (data) => { cache.set(key, { data, at: Date.now() }); notify(); },
      (error) => { cache.set(key, { error, at: Date.now() }); notify(); },
    );
    cache.set(key, { promise, at: Date.now(), data: e?.data });
    if (mounted.current) force((x) => x + 1);
  }, [key, v]);

  const reload = useCallback(() => key && invalidate(key), [key]);
  return { data: entry?.data as T | undefined, error: entry?.error, loading: !!key && entry?.data === undefined && !entry?.error, reload };
}
