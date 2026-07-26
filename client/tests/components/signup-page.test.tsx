/**
 * Signup page (SaaS) — the "tell me exactly what's wrong" contract. Client-side
 * validation gives per-rule guidance on the offending field; when the SERVER
 * rejects (VALIDATION_ERROR), its authoritative per-field `details[]` are shown
 * on the fields — never a bare "fix the fields" banner. DUPLICATE_EMAIL lands on
 * the email field.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/auth', () => ({ signup: vi.fn() }));

import { signup } from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import SignupPage from '../../src/pages/Signup';
import { useAuthStore } from '../../src/stores/authStore';

const mockedSignup = vi.mocked(signup);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: null, user: null, status: 'unauthenticated' });
});

function renderSignup() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<p>dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: { org: string; name: string; email: string; password: string },
) {
  await user.type(screen.getByLabelText(/organization name/i), values.org);
  await user.type(screen.getByLabelText(/your name/i), values.name);
  await user.type(screen.getByLabelText(/email/i), values.email);
  await user.type(screen.getByLabelText(/password/i), values.password);
}

describe('Signup page — clear per-field guidance', () => {
  it('names the exact failing password rule client-side (no server call)', async () => {
    const user = userEvent.setup();
    renderSignup();
    await fill(user, {
      org: 'Gaming Arena',
      name: 'Ali Raza',
      email: 'ali@example.com',
      password: 'passwordonly', // 12 chars, a letter, but NO number
    });
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    expect(await screen.findByText(/must include at least one number/i)).toBeInTheDocument();
    expect(mockedSignup).not.toHaveBeenCalled(); // client blocks the submit
  });

  it('surfaces the SERVER validation reason on the field, not a bare banner', async () => {
    mockedSignup.mockRejectedValue(
      new ApiError({
        code: 'VALIDATION_ERROR',
        message: 'Please fix the highlighted fields.',
        status: 400,
        details: [{ field: 'password', message: 'That password is too common — pick another' }],
      }),
    );
    const user = userEvent.setup();
    renderSignup();
    await fill(user, {
      org: 'Gaming Arena',
      name: 'Ali Raza',
      email: 'ali@example.com',
      password: 'gamingarena1', // passes client rules, rejected by the (mocked) server
    });
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    expect(mockedSignup).toHaveBeenCalledOnce();
    expect(await screen.findByText(/too common — pick another/i)).toBeInTheDocument();
    // The generic banner text must NOT be what the user is left staring at.
    expect(screen.queryByText('Please fix the highlighted fields.')).not.toBeInTheDocument();
  });

  it('puts a taken email on the email field (409 DUPLICATE_EMAIL)', async () => {
    mockedSignup.mockRejectedValue(
      new ApiError({ code: 'DUPLICATE_EMAIL', message: 'dup', status: 409 }),
    );
    const user = userEvent.setup();
    renderSignup();
    await fill(user, {
      org: 'Gaming Arena',
      name: 'Ali Raza',
      email: 'taken@example.com',
      password: 'gamingarena1',
    });
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
  });
});
