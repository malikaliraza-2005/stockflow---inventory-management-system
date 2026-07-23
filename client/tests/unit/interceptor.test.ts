/**
 * F1 — the interceptor pair (ERR §11 frontend rows): single-flight refresh +
 * replay-once, refresh-failure → endSession('expired'), NETWORK_ERROR
 * synthesis (E-1), envelope typing. The adapter is mocked; api/session is
 * mocked so refresh outcomes are scripted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/session', () => ({
  performRefresh: vi.fn(),
  endSession: vi.fn(),
}));

import type { AxiosRequestConfig } from 'axios';

import { api, ApiError } from '../../src/api/client';
import { endSession, performRefresh } from '../../src/api/session';
import { useAuthStore } from '../../src/stores/authStore';

const mockedRefresh = vi.mocked(performRefresh);
const mockedEndSession = vi.mocked(endSession);

type AdapterResult = { status: number; data?: unknown };
type Script = (config: AxiosRequestConfig, attempt: number) => AdapterResult | 'network';

/** Install a scripted adapter; returns the call log. */
function scriptAdapter(script: Script) {
  const calls: AxiosRequestConfig[] = [];
  const perUrlAttempts = new Map<string, number>();
  api.defaults.adapter = (config) => {
    const key = config.url ?? '';
    const attempt = (perUrlAttempts.get(key) ?? 0) + 1;
    perUrlAttempts.set(key, attempt);
    calls.push(config);
    const result = script(config, attempt);
    if (result === 'network') {
      return Promise.reject(
        Object.assign(new Error('Network Error'), { config, isAxiosError: true }),
      );
    }
    if (result.status >= 400) {
      return Promise.reject(
        Object.assign(new Error(`Request failed ${result.status}`), {
          config,
          isAxiosError: true,
          response: { status: result.status, data: result.data ?? {}, headers: {}, config },
        }),
      );
    }
    return Promise.resolve({
      status: result.status,
      statusText: 'OK',
      data: result.data ?? {},
      headers: {},
      config,
    });
  };
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: 'stale-token', user: null, status: 'authenticated' });
});

describe('request interceptor', () => {
  it('attaches the Bearer token from authStore memory', async () => {
    const calls = scriptAdapter(() => ({ status: 200, data: { ok: true } }));
    await api.get('/users/me');
    expect(calls[0]?.headers?.Authorization).toBe('Bearer stale-token');
  });
});

describe('response interceptor — single-flight refresh (ARB-03)', () => {
  it('two parallel 401s → ONE refresh → both replayed once with the new token', async () => {
    mockedRefresh.mockImplementation(async () => {
      useAuthStore.setState({ accessToken: 'fresh-token' });
      return 'fresh-token';
    });
    const calls = scriptAdapter((config, attempt) =>
      attempt === 1 && config.url !== '/auth/refresh'
        ? { status: 401, data: { error: { code: 'UNAUTHORIZED', message: 'expired' } } }
        : { status: 200, data: { ok: config.url } },
    );

    const [a, b] = await Promise.all([api.get('/users/me'), api.get('/users')]);
    expect(a.data).toEqual({ ok: '/users/me' });
    expect(b.data).toEqual({ ok: '/users' });
    expect(mockedRefresh).toHaveBeenCalledTimes(1); // single flight

    const replays = calls.filter((c) => c.headers?.Authorization === 'Bearer fresh-token');
    expect(replays).toHaveLength(2); // each original replayed exactly once
  });

  it('replay that 401s again is TERMINAL — no refresh loop', async () => {
    mockedRefresh.mockResolvedValue('fresh-token');
    scriptAdapter(() => ({
      status: 401,
      data: { error: { code: 'UNAUTHORIZED', message: 'still dead' } },
    }));

    await expect(api.get('/users/me')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockedRefresh).toHaveBeenCalledTimes(1); // once, not twice
  });

  it('refresh failure → endSession("expired") + typed error (EC-30)', async () => {
    mockedRefresh.mockRejectedValue(new Error('refresh dead'));
    scriptAdapter(() => ({
      status: 401,
      data: { error: { code: 'UNAUTHORIZED', message: 'expired' } },
    }));

    await expect(api.get('/users/me')).rejects.toBeInstanceOf(ApiError);
    expect(mockedEndSession).toHaveBeenCalledWith('expired');
  });

  it('401 on an auth route is a terminal answer — no refresh attempt', async () => {
    scriptAdapter(() => ({
      status: 401,
      data: { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password.' } },
    }));

    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockedRefresh).not.toHaveBeenCalled();
  });
});

describe('response interceptor — error typing', () => {
  it('synthesizes NETWORK_ERROR (E-1) when there is no response', async () => {
    scriptAdapter(() => 'network');
    await expect(api.get('/users')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('types the wire envelope into ApiError with correlation ID', async () => {
    scriptAdapter(() => ({
      status: 409,
      data: {
        error: {
          code: 'DUPLICATE_EMAIL',
          message: 'Email already in use.',
          details: { email: 'x@y.z' },
          correlationId: 'c1f4',
        },
      },
    }));

    const failure = await api.post('/users', {}).catch((e: unknown) => e as ApiError);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: 'DUPLICATE_EMAIL',
      status: 409,
      correlationId: 'c1f4',
    });
  });

  it('shapes a codeless body as INTERNAL_ERROR (05 §1: tolerate unknowns)', async () => {
    scriptAdapter(() => ({ status: 500, data: 'gateway text' }));
    await expect(api.get('/users')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
