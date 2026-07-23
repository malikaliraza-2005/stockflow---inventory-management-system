/**
 * useQueryState — FEA §4.1 / SMA §6: the page-scoped server-state pattern.
 * `{data, loading, error, refetch}`, built on the typed API clients (FD-1 —
 * no query library). Mutation → explicit refetch (FD-2). 401s are invisible:
 * the interceptor's single-flight refresh resolves them (SMA §6).
 *
 * A monotonic request token drops stale responses when params change faster
 * than the network returns (last-write-wins on the latest fetch).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useQueryState<T>(fetcher: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(() => {
    const id = (requestId.current += 1);
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((result) => {
        if (id === requestId.current) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return; // stale — a newer fetch owns the state
        setError(
          err instanceof ApiError
            ? err
            : new ApiError({ code: 'INTERNAL_ERROR', message: 'Request failed', status: 0 }),
        );
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller owns the dep list
  }, deps);

  return { data, loading, error, refetch: run };
}
