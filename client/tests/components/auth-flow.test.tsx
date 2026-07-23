/**
 * F1 — guard spine + auth pages against their contracts (UCA §6, SMP §6,
 * WIR states): RequireAuth redirect, ForcePasswordChange gate, Login generic
 * error + input preservation, ResetPassword dead-link state.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
  bootstrapSession: vi.fn(),
}));

import { login } from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import { ForcePasswordChangeGate } from '../../src/components/layout/ForcePasswordChange';
import { RequireAuth } from '../../src/components/layout/RequireAuth';
import LoginPage from '../../src/pages/Login';
import ResetPasswordPage from '../../src/pages/ResetPassword';
import { useAuthStore } from '../../src/stores/authStore';

const mockedLogin = vi.mocked(login);

const USER = {
  id: 'u1',
  name: 'Sara',
  email: 'sara@example.com',
  role: 'STAFF' as const,
  mustChangePassword: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: null, user: null, status: 'unauthenticated' });
});

function renderProtected(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<p>login screen</p>} />
        <Route element={<RequireAuth />}>
          <Route element={<ForcePasswordChangeGate />}>
            <Route path="/" element={<p>protected content</p>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAuth (SMP §6)', () => {
  it('renders the bootstrap skeleton while initializing — no login flash', () => {
    useAuthStore.setState({ status: 'initializing' });
    renderProtected();
    expect(screen.getByTestId('bootstrap-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });

  it('redirects an unauthenticated session to /login', () => {
    renderProtected();
    expect(screen.getByText('login screen')).toBeInTheDocument();
  });

  it('renders protected content for an authenticated session', () => {
    useAuthStore.setState({ accessToken: 't', user: USER, status: 'authenticated' });
    renderProtected();
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});

describe('ForcePasswordChange gate (FEV-02)', () => {
  it('replaces EVERY protected route with the change-password screen while flagged', () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { ...USER, mustChangePassword: true },
      status: 'authenticated',
    });
    renderProtected();
    expect(screen.getByTestId('force-password-change')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('releases the gate when the flag clears', () => {
    useAuthStore.setState({ accessToken: 't', user: USER, status: 'authenticated' });
    renderProtected();
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});

describe('Login page (UC-01 — generic errors, input preserved)', () => {
  function renderLogin() {
    return render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('submits credentials through the schema (normalized email)', async () => {
    mockedLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), ' Sara@Example.COM ');
    await user.type(screen.getByLabelText(/password/i), 'any-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(mockedLogin).toHaveBeenCalledWith('sara@example.com', 'any-password');
  });

  it('shows the GENERIC message on 401 and PRESERVES input (AAD §2, EC-28)', async () => {
    mockedLogin.mockRejectedValue(
      new ApiError({ code: 'UNAUTHORIZED', message: 'server text', status: 401 }),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'sara@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toHaveValue('wrong-password'); // never discarded
  });

  it('renders the distinct 423 lockout state', async () => {
    mockedLogin.mockRejectedValue(
      new ApiError({ code: 'ACCOUNT_LOCKED', message: 'locked', status: 423 }),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'sara@example.com');
    await user.type(screen.getByLabelText(/password/i), 'whatever-pw');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/temporarily locked/i)).toBeInTheDocument();
  });
});

describe('Reset Password page (UC-03 — dead-link state, SMP §5)', () => {
  it('missing token → in-page invalid state, no redirect loop', () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('reset-token-invalid')).toBeInTheDocument();
  });
});
