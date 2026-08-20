/**
 * The REPORTED BUG, reproduced at the level the user experiences it: sign in
 * successfully, then get bounced back to the login page.
 *
 * Nothing in the api layer is mocked here — the real auth client, the real
 * session orchestration, the real interceptors and the real guard spine all
 * run. Only the transport (the axios adapter) is scripted, so the sequence is
 * exactly what a cold API produces:
 *
 *   1. App boots → POST /auth/refresh → hangs (server waking up)
 *   2. User signs in → POST /auth/login → 200 → /dashboard
 *   3. The bootstrap refresh finally answers → 401
 *
 * Step 3 used to call clearSession() unconditionally, throwing away the session
 * step 2 had just created. Google made it worse: one click loses this race far
 * more often than typing a password does.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios, { type AxiosAdapter } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

import { bootstrapSession } from '../../src/api/auth';
import { api } from '../../src/api/client';
import { RequireAuth } from '../../src/components/layout/RequireAuth';
import LoginPage from '../../src/pages/Login';
import { useAuthStore } from '../../src/stores/authStore';

const SESSION = {
  accessToken: 'access-token-from-login',
  user: {
    id: 'u1',
    name: 'Sara',
    email: 'sara@example.com',
    role: 'ADMIN',
    mustChangePassword: false,
  },
  settings: { systemCurrency: 'USD', movementWarningThreshold: 1000 },
};

function ok(config: unknown, data: unknown) {
  return Promise.resolve({
    status: 200,
    statusText: 'OK',
    data,
    headers: {},
    config: config as never,
  });
}

function unauthorized(config: unknown) {
  return Promise.reject(
    Object.assign(new Error('Request failed 401'), {
      config,
      isAxiosError: true,
      response: {
        status: 401,
        data: { error: { code: 'UNAUTHORIZED', message: 'No session' } },
        headers: {},
        config,
      },
    }),
  );
}

beforeEach(() => {
  // The real cold-start state: bootstrap in flight, nothing decided yet.
  useAuthStore.setState({ accessToken: null, user: null, status: 'initializing', epoch: 0 });
});

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<h1>Dashboard</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('signing in while the bootstrap refresh is still in flight', () => {
  it('lands on the dashboard and STAYS there when the refresh 401 arrives late', async () => {
    // The bootstrap refresh (bare axios) hangs until we release it.
    let failTheRefresh!: () => void;
    const refreshAnswered = new Promise<void>((resolve) => {
      failTheRefresh = resolve;
    });
    axios.defaults.adapter = (async (config) => {
      await refreshAnswered; // still waking up…
      return unauthorized(config);
    }) as AxiosAdapter;

    // The login POST (the `api` instance) succeeds immediately.
    api.defaults.adapter = ((config) => ok(config, SESSION)) as AxiosAdapter;

    const user = userEvent.setup();
    renderApp();
    void bootstrapSession(); // A-7, exactly as App.tsx fires it

    await user.type(screen.getByLabelText(/email/i), 'sara@example.com');
    await user.type(screen.getByLabelText(/password/i), 'correct-h0rse-battery');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // The redirect lands… (generous timeouts: these assert an async ORDERING,
    // not a latency budget — the default 1s loses to full-suite CPU contention)
    expect(
      await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 10_000 }),
    ).toBeInTheDocument();

    // …and NOW the stale bootstrap refresh finally fails.
    failTheRefresh();
    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'), {
      timeout: 10_000,
    });

    // The bug was here: the user was thrown back to the login page.
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBe('access-token-from-login');
  });

  it('with no login racing it, a failed bootstrap still shows the login page', async () => {
    axios.defaults.adapter = ((config) => unauthorized(config)) as AxiosAdapter;
    api.defaults.adapter = ((config) => ok(config, SESSION)) as AxiosAdapter;

    renderApp();
    await bootstrapSession();

    await waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'), {
      timeout: 10_000,
    });
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});
