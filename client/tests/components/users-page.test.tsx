/**
 * F2 — Users page + UserFormModal + ResetLinkModal against their contracts:
 * list render, provisioning happy path, DUPLICATE_EMAIL inline echo, the
 * reset-link (AS-6) display, and the last-admin (LAST_ADMIN) inline conflict.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/users', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  issueResetLink: vi.fn(),
  getOwnProfile: vi.fn(),
  updateOwnProfile: vi.fn(),
}));

import { createUser, issueResetLink, listUsers, updateUser } from '../../src/api/users';
import { ApiError } from '../../src/api/client';
import UsersPage from '../../src/pages/Users';

const mockedList = vi.mocked(listUsers);
const mockedCreate = vi.mocked(createUser);
const mockedUpdate = vi.mocked(updateUser);
const mockedReset = vi.mocked(issueResetLink);

const USERS = [
  {
    id: 'u1',
    name: 'Alice Admin',
    email: 'alice@example.com',
    role: 'ADMIN' as const,
    isActive: true,
    createdAt: '2026-07-01T00:00:00.000Z',
    lastLoginAt: '2026-07-20T09:00:00.000Z',
  },
  {
    id: 'u2',
    name: 'Bob Staff',
    email: 'bob@example.com',
    role: 'STAFF' as const,
    isActive: true,
    createdAt: '2026-07-02T00:00:00.000Z',
  },
];

function listResponse(data = USERS) {
  return { data, page: 1, limit: 20, totalItems: data.length, totalPages: 1 };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/users']}>
      <UsersPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue(listResponse());
});

describe('Users page (UC-04)', () => {
  it('renders the user rows from the list query', async () => {
    renderPage();
    expect(await screen.findAllByText('Alice Admin')).not.toHaveLength(0);
    expect(screen.getAllByText('bob@example.com').length).toBeGreaterThan(0);
  });

  it('provisions a user (BR-31) and refetches', async () => {
    mockedCreate.mockResolvedValue({ ...USERS[1]!, id: 'u3', email: 'new@example.com' });
    renderPage();
    await screen.findAllByText('Alice Admin');

    await userEvent.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'New Person');
    await userEvent.type(within(dialog).getByLabelText(/email/i), 'new@example.com');
    await userEvent.type(within(dialog).getByLabelText(/temporary password/i), 'temp-passw0rd-1');
    await userEvent.click(within(dialog).getByRole('button', { name: /create user/i }));

    expect(mockedCreate).toHaveBeenCalledWith({
      name: 'New Person',
      email: 'new@example.com',
      role: 'STAFF',
      temporaryPassword: 'temp-passw0rd-1',
    });
    expect(mockedList).toHaveBeenCalledTimes(2); // initial + post-save refetch
  });

  it('maps DUPLICATE_EMAIL to an inline field error, preserving input (EC-28)', async () => {
    mockedCreate.mockRejectedValue(
      new ApiError({ code: 'DUPLICATE_EMAIL', message: 'dup', status: 409 }),
    );
    renderPage();
    await screen.findAllByText('Alice Admin');

    await userEvent.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'Twin');
    await userEvent.type(within(dialog).getByLabelText(/email/i), 'alice@example.com');
    await userEvent.type(within(dialog).getByLabelText(/temporary password/i), 'temp-passw0rd-1');
    await userEvent.click(within(dialog).getByRole('button', { name: /create user/i }));

    expect(await within(dialog).findByText(/email already in use/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/email/i)).toHaveValue('alice@example.com'); // preserved
  });

  it('shows the out-of-band reset link with a copy control (AS-6)', async () => {
    mockedReset.mockResolvedValue({
      resetLink: 'http://localhost:5173/reset-password?token=abc123',
      expiresAt: '2026-07-23T12:30:00.000Z',
    });
    renderPage();
    await screen.findAllByText('Alice Admin');

    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]!);
    await userEvent.click(screen.getAllByRole('menuitem', { name: /reset password/i })[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Reset link')).toHaveValue(
      'http://localhost:5173/reset-password?token=abc123',
    );
    expect(within(dialog).getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('maps LAST_ADMIN to an inline conflict on edit (BR-30)', async () => {
    mockedUpdate.mockRejectedValue(
      new ApiError({ code: 'LAST_ADMIN', message: 'last admin', status: 409 }),
    );
    renderPage();
    await screen.findAllByText('Alice Admin');

    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]!);
    await userEvent.click(screen.getAllByRole('menuitem', { name: 'Edit' })[0]!);

    const dialog = await screen.findByRole('dialog');
    // Demote the sole admin
    await userEvent.selectOptions(within(dialog).getByLabelText(/role/i), 'STAFF');
    await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    expect(await within(dialog).findByText(/last active admin/i)).toBeInTheDocument();
  });
});
