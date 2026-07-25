/**
 * F6 — useIdempotencyKey lifecycle (BR-20 / ARB-02): a stable key across retries,
 * a fresh key after reset (success/cancel).
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIdempotencyKey } from '../../src/hooks/useIdempotencyKey';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('useIdempotencyKey', () => {
  it('returns the same RFC-4122 key on repeated calls (retry replays)', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.current();
    expect(first).toMatch(UUID);
    expect(result.current.current()).toBe(first);
  });

  it('mints a fresh key after reset (new attempt-group)', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.current();
    act(() => result.current.reset());
    const second = result.current.current();
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });
});
