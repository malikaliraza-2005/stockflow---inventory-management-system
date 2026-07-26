/**
 * F7 (P5 slice) — Audit Trail tab: renders audit rows (actor, action,
 * entityLabel), the entity filter (matrix), DataTable row EXPANSION for
 * before/after diffs with accessible aria-expanded toggles, and security-event
 * rows (no field changes). Plus the Transactions tab gating: Admin sees an
 * enabled Audit Trail tab; Staff sees it disabled.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/audit', () => ({ listAuditLogs: vi.fn() }));
vi.mock('../../src/api/transactions', () => ({ listTransactions: vi.fn() }));

import { listAuditLogs, type AuditLogRow } from '../../src/api/audit';
import { listTransactions } from '../../src/api/transactions';
import { AuditTrailTab } from '../../src/components/domain/AuditTrailTab';
import TransactionsPage from '../../src/pages/Transactions';
import { useAuthStore } from '../../src/stores/authStore';

const mockedAudit = vi.mocked(listAuditLogs);
const mockedLedger = vi.mocked(listTransactions);

const ROWS: AuditLogRow[] = [
  {
    id: 'a1',
    actorId: 'u1',
    actorName: 'Ada Admin',
    entityType: 'PRODUCT' as const,
    entityId: 'p1',
    entityLabel: 'Widget (W-1)',
    action: 'UPDATE',
    changes: [{ field: 'name', before: 'Old Name', after: 'New Name' }],
    createdAt: '2026-07-25T10:00:00.000Z',
  },
  {
    id: 'a2',
    actorId: 'u1',
    actorName: 'Ada Admin',
    entityType: 'SECURITY' as const,
    entityLabel: 'attacker@example.com',
    action: 'LOGIN_FAILED',
    ip: '203.0.113.9',
    createdAt: '2026-07-25T09:00:00.000Z',
  },
];

function auditResponse(data = ROWS) {
  return { data, page: 1, limit: 20, totalItems: data.length, totalPages: 1 };
}

function seedRole(role: 'ADMIN' | 'STAFF') {
  useAuthStore.getState().setSession('token', {
    id: 'u1',
    name: 'Ada Admin',
    email: 'ada@example.com',
    role,
    mustChangePassword: false,
  });
}

function renderTab(entry = '/transactions?tab=audit') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuditTrailTab />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAudit.mockResolvedValue(auditResponse());
  mockedLedger.mockResolvedValue({ data: [], page: 1, limit: 20, totalItems: 0, totalPages: 0 });
  seedRole('ADMIN');
});

describe('AuditTrailTab (F7)', () => {
  it('renders rows with actor, action, and DN-4 entityLabel', async () => {
    renderTab();
    expect(await screen.findAllByText('Widget (W-1)')).not.toHaveLength(0);
    expect(screen.getAllByText('Ada Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('UPDATE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('attacker@example.com').length).toBeGreaterThan(0); // security event visible
  });

  it('expands a row to reveal the before/after diff (accessible toggle)', async () => {
    renderTab();
    await screen.findAllByText('Widget (W-1)');

    const toggles = screen.getAllByRole('button', { name: 'Expand row' });
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggles[0]!);

    expect(screen.getAllByRole('button', { name: 'Collapse row' })[0]).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getAllByText('Old Name').length).toBeGreaterThan(0);
    expect(screen.getAllByText('New Name').length).toBeGreaterThan(0);
  });

  it('shows "No field changes" when a security event is expanded', async () => {
    renderTab();
    await screen.findAllByText('attacker@example.com');
    // Second row (security event) — its expand toggle is the 2nd desktop toggle.
    const toggles = screen.getAllByRole('button', { name: 'Expand row' });
    await userEvent.click(toggles[1]!);
    expect(screen.getAllByText(/No field changes/).length).toBeGreaterThan(0);
  });

  it('filters by entity type (matrix)', async () => {
    renderTab();
    await screen.findAllByText('Widget (W-1)');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SECURITY');
    await vi.waitFor(() =>
      expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'SECURITY' })),
    );
  });
});

describe('Transactions tab gating', () => {
  it('Admin sees an enabled Audit Trail tab and can open it', async () => {
    seedRole('ADMIN');
    render(
      <MemoryRouter initialEntries={['/transactions']}>
        <TransactionsPage />
      </MemoryRouter>,
    );
    const auditTab = screen.getByRole('tab', { name: /audit trail/i });
    expect(auditTab).not.toBeDisabled();
    await userEvent.click(auditTab);
    expect(await screen.findAllByText('Widget (W-1)')).not.toHaveLength(0);
  });

  it('Staff sees the Audit Trail tab disabled', () => {
    seedRole('STAFF');
    render(
      <MemoryRouter initialEntries={['/transactions']}>
        <TransactionsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: /audit trail/i })).toBeDisabled();
  });
});
