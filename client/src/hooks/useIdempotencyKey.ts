/**
 * useIdempotencyKey — the BR-20 / ARB-02 client lifecycle (UCA §5.1, WIR §17.3).
 *
 * `current()` lazily mints one RFC-4122 key and returns the SAME key on every
 * subsequent call — so a network-timeout retry replays the original submission
 * (NFR-19), never double-applies it. `reset()` clears the key; the next
 * `current()` mints a fresh one. Dialogs reset on open, and after a confirmed
 * success or an explicit cancel, so each attempt-group gets exactly one key.
 */
import { useCallback, useMemo, useRef } from 'react';

export interface IdempotencyKey {
  /** The current key for this attempt-group; minted on first use, stable after. */
  current: () => string;
  /** Drop the key so the next attempt-group mints a fresh one. */
  reset: () => void;
}

export function useIdempotencyKey(): IdempotencyKey {
  const keyRef = useRef<string | null>(null);

  const current = useCallback(() => {
    keyRef.current ??= crypto.randomUUID();
    return keyRef.current;
  }, []);

  const reset = useCallback(() => {
    keyRef.current = null;
  }, []);

  // Stable reference — consumers put this object in effect deps (dialog reset).
  return useMemo(() => ({ current, reset }), [current, reset]);
}
