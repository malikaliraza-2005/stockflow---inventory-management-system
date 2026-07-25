/**
 * F10 — Reports page: the URL-param report selector, per-report filters + totals
 * + footnote, the Admin-only export button and Consistency tab (hidden for
 * Staff), the pre-filled mandatory date range, and the ERR §7 export retry toast.
 * The report/category APIs are mocked — this owns the page ORCHESTRATION.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('../../src/hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: toastError, info: vi.fn() }),
}));
vi.mock('../../src/api/categories', () => ({ listCategories: vi.fn() }));
vi.mock('../../src/api/reports', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/api/reports')>('../../src/api/reports');
  return {
    ...actual,
    getInventoryReport: vi.fn(),
    getLowStockReport: vi.fn(),
    getTransactionsReport: vi.fn(),
    getProductPerformanceReport: vi.fn(),
    getConsistencyReport: vi.fn(),
    exportReport: vi.fn(),
  };
});

import { listCategories } from '../../src/api/categories';
import {
  exportReport,
  getConsistencyReport,
  getInventoryReport,
  getTransactionsReport,
} from '../../src/api/reports';
import ReportsPage from '../../src/pages/Reports';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedInventory = vi.mocked(getInventoryReport);
const mockedTransactions = vi.mocked(getTransactionsReport);
const mockedConsistency = vi.mocked(getConsistencyReport);
const mockedExport = vi.mocked(exportReport);
const mockedCategories = vi.mocked(listCategories);

function meta() {
  return { page: 1, limit: 20, totalItems: 1, totalPages: 1 };
}

function inventoryReport() {
  return {
    ...meta(),
    data: [
      {
        id: 'p1',
        sku: 'W-1',
        name: 'Widget',
        categoryName: 'Electronics',
        quantity: 5,
        costPrice: '4.00',
        lineValue: '20.00',
        stockStatus: 'IN_STOCK' as const,
      },
    ],
    totals: { totalQuantity: 5, totalValue: '20.00' },
  };
}

function consistencyReport() {
  return {
    ...meta(),
    data: [
      {
        productId: 'p1',
        productSku: 'W-1',
        productName: 'Widget',
        ledgerSum: 5,
        quantity: 9,
        drift: true,
      },
    ],
  };
}

function seedRole(role: 'ADMIN' | 'STAFF') {
  useSettingsStore.getState().setSettings({ currency: 'USD', movementWarningThreshold: 1000 });
  useAuthStore.getState().setSession('token', {
    id: 'u1',
    name: 'User',
    email: 'u@example.com',
    role,
    mustChangePassword: false,
  });
}

function renderPage(entry = '/reports') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ReportsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCategories.mockResolvedValue({
    data: [],
    page: 1,
    limit: 100,
    totalItems: 0,
    totalPages: 0,
  });
  mockedInventory.mockResolvedValue(inventoryReport());
  mockedTransactions.mockResolvedValue({ ...meta(), data: [] });
  mockedConsistency.mockResolvedValue(consistencyReport());
  seedRole('ADMIN');
});

describe('Reports page (FR-RPT-01…06)', () => {
  it('renders the inventory report with a totals row and the timezone/cost footnote', async () => {
    renderPage();
    expect((await screen.findAllByText('Widget')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Totals: 5 units/)).toBeInTheDocument();
    expect(screen.getByText(/Monetary values use current cost/)).toBeInTheDocument();
  });

  it('Admin sees export + the Consistency tab; switching shows the drift badge', async () => {
    renderPage();
    await screen.findAllByText('Widget');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Consistency' }));
    expect((await screen.findAllByText('Drift')).length).toBeGreaterThan(0);
    expect(mockedConsistency).toHaveBeenCalled();
  });

  it('hides export + the Consistency tab from Staff', async () => {
    seedRole('STAFF');
    renderPage();
    await screen.findAllByText('Widget');
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Consistency' })).not.toBeInTheDocument();
  });

  it('pre-fills the mandatory date range on the transactions report', async () => {
    renderPage();
    await screen.findAllByText('Widget');
    await userEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    expect(mockedTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
    );
    expect(mockedTransactions.mock.calls[0]?.[0].from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows a retry toast when the CSV export stream aborts (ERR §7)', async () => {
    mockedExport.mockRejectedValue(new Error('aborted'));
    renderPage();
    await screen.findAllByText('Widget');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/retry/i));
  });
});
