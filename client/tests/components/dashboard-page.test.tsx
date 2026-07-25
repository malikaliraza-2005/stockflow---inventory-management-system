/**
 * F9 — Dashboard page: renders the single-aggregate KPIs, stock alerts (with
 * deep links + pre-filled Stock In), recent movements, the `asOf` stamp, and the
 * range toggle that re-queries. ChartPanel + the movement dialog are stubbed —
 * this test owns the ORCHESTRATION (data → surfaces + wiring), not Recharts or
 * the F6 dialog internals (covered by their own suites).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/dashboard', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/api/dashboard')>('../../src/api/dashboard');
  return { ...actual, getDashboardSummary: vi.fn() };
});
vi.mock('../../src/components/domain/ChartPanel', () => ({
  default: () => <div data-testid="chart-panel" />,
}));
vi.mock('../../src/components/domain/StockMovementDialog', () => ({
  StockMovementDialog: (props: { open: boolean; product?: { id: string } }) =>
    props.open ? (
      <div data-testid="movement-dialog" data-product={props.product?.id ?? 'none'} />
    ) : null,
}));

import { getDashboardSummary } from '../../src/api/dashboard';
import DashboardPage from '../../src/pages/Dashboard';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedSummary = vi.mocked(getDashboardSummary);

function summary() {
  return {
    asOf: '2026-07-25T12:00:00.000Z',
    totals: { activeProducts: 3, inventoryValue: '215.00', unitsInStock: 53 },
    lowStock: {
      count: 1,
      items: [{ id: 'low1', name: 'LowStock', sku: 'LOW-1', quantity: 3, lowStockThreshold: 10 }],
    },
    outOfStock: {
      count: 1,
      items: [{ id: 'out1', name: 'OutStock', sku: 'OUT-1', quantity: 0, lowStockThreshold: 5 }],
    },
    recentTransactions: [
      {
        id: 't1',
        createdAt: '2026-07-25T11:00:00.000Z',
        productId: 'p1',
        productName: 'Widget',
        productSku: 'W-1',
        productArchived: false,
        type: 'STOCK_IN' as const,
        quantityChange: 5,
        quantityAfter: 15,
        userId: 'u1',
        userName: 'Ada',
      },
    ],
    charts: {
      movementTrend: [{ date: '2026-07-25', in: 5, out: 0 }],
      transactionVolume: [{ date: '2026-07-25', count: 1 }],
    },
  };
}

function renderPage(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSummary.mockResolvedValue(summary());
  useSettingsStore.getState().setSettings({ currency: 'USD', movementWarningThreshold: 1000 });
  useAuthStore.getState().setSession('token', {
    id: 'admin',
    name: 'Ada Admin',
    email: 'ada@example.com',
    role: 'ADMIN',
    mustChangePassword: false,
  });
});

describe('Dashboard page (FR-DASH-01…04)', () => {
  it('renders the three KPIs from the single aggregate call', async () => {
    renderPage();
    expect(await screen.findByText('$215.00')).toBeInTheDocument();
    expect(screen.getByText('53')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(mockedSummary).toHaveBeenCalledWith(30); // default range
  });

  it('surfaces the asOf staleness stamp (BR-25)', async () => {
    renderPage();
    expect(await screen.findByText(/^as of /)).toBeInTheDocument();
  });

  it('renders stock alerts: low shows qty/threshold + product link; out lists the item', async () => {
    renderPage();
    const low = await screen.findByRole('region', { name: 'Low stock' });
    expect(within(low).getByText('LowStock')).toBeInTheDocument();
    expect(within(low).getByText('3 / 10')).toBeInTheDocument();
    expect(within(low).getByRole('link', { name: /LowStock/ })).toHaveAttribute(
      'href',
      '/products/low1',
    );
    const out = screen.getByRole('region', { name: 'Out of stock' });
    expect(within(out).getByText('OutStock')).toBeInTheDocument();
  });

  it('deep-links recent transactions to the product-filtered ledger', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Widget' });
    expect(link).toHaveAttribute('href', '/transactions?productId=p1');
  });

  it('re-queries when the range toggle changes', async () => {
    renderPage();
    await screen.findByText('$215.00');
    await userEvent.click(screen.getByRole('button', { name: '90d' }));
    expect(mockedSummary).toHaveBeenCalledWith(90);
  });

  it('opens the movement dialog context-free from [New movement] and pre-filled from an alert [+]', async () => {
    renderPage();
    await screen.findByText('$215.00');

    await userEvent.click(screen.getByRole('button', { name: 'New movement' }));
    expect(screen.getByTestId('movement-dialog')).toHaveAttribute('data-product', 'none');

    await userEvent.click(screen.getByRole('button', { name: 'Stock in LowStock' }));
    expect(screen.getByTestId('movement-dialog')).toHaveAttribute('data-product', 'low1');
  });
});
