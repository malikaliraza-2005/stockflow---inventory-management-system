/**
 * useUrlState — SMP §4: view state that should survive refresh/sharing lives
 * in URL search params, not a store. Thin typed wrapper over
 * react-router's useSearchParams: reads with defaults, writes by patching.
 * Changing a filter resets page to 1 (the caller opts in via `resetPage`).
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlState() {
  const [params, setParams] = useSearchParams();

  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);

  const getNumber = useCallback(
    (key: string, fallback: number) => {
      const raw = params.get(key);
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    [params],
  );

  /** Patch params; undefined/'' removes the key. Optionally reset page=1. */
  const patch = useCallback(
    (updates: Record<string, string | number | undefined>, resetPage = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage) next.set('page', '1');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { get, getNumber, patch };
}
