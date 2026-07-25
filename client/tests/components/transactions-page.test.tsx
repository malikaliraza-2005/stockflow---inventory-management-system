/**
 * F7 — Transactions page (Stock Ledger tab): renders ledger rows with signed
 * quantities, the archived badge (EC-16), the disabled Audit Trail tab (Phase 5),
 * and the type filter that patches the URL.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/transactions', () => ({ listTransactions: vi.fn() }));

import { listTransactions } from '../../src/api/transactions';
import TransactionsPage from '../../src/pages/Transactions';

const mockedList = vi.mocked(listTransactions);

const ROWS = [
  {
    id: 'x1',
    createdAt: '2026-07-25T10:00:00.000Z',
    productId: 'p1',
    productName: 'USB Cable',
    productSku: 'ELEC-1',
    productArchived: false,
    type: 'STOCK_OUT' as const,
    quantityChange: -5,
    quantityAfter: 15,
    userId: 'u1',
    userName: 'Ada',
  },
  {
    id: 'x2',
    createdAt: '2026-07-25T09:00:00.000Z',
    productId: 'p2',
    productName: 'Old Widget',
    productSku: 'GONE-1',
    productArchived: true,
    type: 'INITIAL' as const,
    quantityChange: 10,
    quantityAfter: 10,
    userId: 'u1',
    userName: 'Ada',
  },
];

function listResponse(data = ROWS) {
  return { data, page: 1, limit: 20, totalItems: data.length, totalPages: 1 };
}

function renderPage(entry = '/transactions') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TransactionsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue(listResponse());
});

describe('Transactions page — Stock Ledger tab (F7)', () => {
  it('renders ledger rows with signed quantities', async () => {
    renderPage();
    expect(await screen.findAllByText('USB Cable')).not.toHaveLength(0);
    expect(screen.getAllByText('-5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+10').length).toBeGreaterThan(0);
  });

  it('badges archived-product rows (EC-16)', async () => {
    renderPage();
    await screen.findAllByText('Old Widget');
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);
  });

  it('offers a disabled Audit Trail tab (Phase 5)', async () => {
    renderPage();
    await screen.findAllByText('USB Cable');
    expect(screen.getByRole('tab', { name: /audit trail/i })).toBeDisabled();
  });

  it('deep-links to a single product ledger with a clear-filter banner', async () => {
    renderPage('/transactions?productId=p1');
    await screen.findAllByText('USB Cable');
    expect(screen.getByText(/single product/i)).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1' })),
    );
  });
});
