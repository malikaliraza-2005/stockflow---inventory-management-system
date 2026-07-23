/**
 * F2 — useQueryState (SMA §6): loading→data, error typing, refetch, and the
 * stale-response guard (params change faster than the network returns).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

import { ApiError } from '../../src/api/client';
import { useQueryState } from '../../src/hooks/useQueryState';

describe('useQueryState', () => {
  it('transitions loading → data', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 42 });
    const { result } = renderHook(() => useQueryState(fetcher, []));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
  });

  it('captures a typed ApiError', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new ApiError({ code: 'NOT_FOUND', message: 'gone', status: 404 }));
    const { result } = renderHook(() => useQueryState(fetcher, []));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.code).toBe('NOT_FOUND');
  });

  it('refetch re-runs the fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useQueryState(fetcher, []));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.refetch());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it('drops a stale response when a newer fetch resolves first', async () => {
    let resolveFirst!: (value: unknown) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ tag: 'second' });

    const { result } = renderHook(() => useQueryState(fetcher, []));
    act(() => result.current.refetch()); // second fetch starts
    await waitFor(() => expect(result.current.data).toEqual({ tag: 'second' }));

    // the first (stale) fetch resolves LAST — must be ignored
    act(() => resolveFirst({ tag: 'first' }));
    expect(result.current.data).toEqual({ tag: 'second' });
  });
});
