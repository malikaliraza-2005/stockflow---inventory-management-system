/**
 * A-7 bootstrap refresh — the two races that stranded users on /login:
 *
 *  1. StrictMode invokes the bootstrap effect TWICE. Two overlapping
 *     `/auth/refresh` calls on one cookie trip the server's reuse detection
 *     (BR-35) and revoke the whole family, so the bootstrap must join the
 *     interceptor's single flight rather than open its own.
 *  2. On a cold API the bootstrap refresh can still be in flight when the user
 *     signs in. Its late 401 must not clear the session that login just
 *     established (the epoch guard).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/session', () => ({
  performRefresh: vi.fn(),
  applySession: vi.fn(),
  endSession: vi.fn(),
}));

import { bootstrapSession } from '../../src/api/auth';
import { performRefresh } from '../../src/api/session';
import { useAuthStore, type SessionUser } from '../../src/stores/authStore';

const mockedRefresh = vi.mocked(performRefresh);

const USER = {
  id: 'u1',
  name: 'Sara',
  email: 'sara@example.com',
  role: 'STAFF',
  mustChangePassword: false,
} as unknown as SessionUser;

/** A promise whose settlement this test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: null, user: null, status: 'initializing', epoch: 0 });
});

describe('bootstrapSession', () => {
  it('StrictMode double-mount issues ONE refresh, not two (BR-35 family kill)', async () => {
    const gate = deferred<string>();
    mockedRefresh.mockReturnValue(gate.promise);

    const first = bootstrapSession();
    const second = bootstrapSession();
    gate.resolve('token');
    await Promise.all([first, second]);

    expect(mockedRefresh).toHaveBeenCalledTimes(1);
  });

  it('a refresh failure landing AFTER a login leaves the new session alone', async () => {
    const gate = deferred<string>();
    mockedRefresh.mockReturnValue(gate.promise);

    const bootstrap = bootstrapSession(); // cold API — still in flight
    useAuthStore.getState().setSession('fresh-token', USER); // user signs in meanwhile
    gate.reject(new Error('no cookie'));
    await bootstrap;

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().accessToken).toBe('fresh-token');
  });

  it('a refresh failure with nothing else in play still resolves to unauthenticated', async () => {
    mockedRefresh.mockRejectedValue(new Error('no cookie'));

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});
