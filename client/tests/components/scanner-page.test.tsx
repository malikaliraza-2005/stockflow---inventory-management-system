/**
 * F8 — Scanner page integration (the E2E scan flow via MANUAL ENTRY, TST Issue 1
 * — zero camera mocks). Drives the lookup tail of the FEA §6.1 machine through
 * the always-visible manual field:
 *   found → launch the F6 dialog → record → success flash + updated qty
 *   not-found → Admin create-from-code (route state) · Staff notify
 *   archived → Admin restore
 *   server INVALID_BARCODE → the page's invalid state
 * The camera viewport is lazy and inert in jsdom (no mediaDevices) — the page
 * shell and manual entry never depend on it.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/products', () => ({
  lookupProduct: vi.fn(),
  restoreProduct: vi.fn(),
  listProducts: vi.fn(),
}));
vi.mock('../../src/api/movements', () => ({ recordMovement: vi.fn() }));

import { ApiError } from '../../src/api/client';
import {
  lookupProduct,
  restoreProduct,
  type Product,
  type ProductLookup,
} from '../../src/api/products';
import { recordMovement } from '../../src/api/movements';
import ScannerPage from '../../src/pages/Scanner';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedLookup = vi.mocked(lookupProduct);
const mockedRestore = vi.mocked(restoreProduct);
const mockedRecord = vi.mocked(recordMovement);

// A real 24-hex ObjectId — the F6 movement schema validates `productId`.
const PID = '507f1f77bcf86cd799439011';

const FOUND: ProductLookup = {
  id: PID,
  name: 'USB-C Cable',
  sku: 'ELEC-1',
  quantity: 12,
  stockStatus: 'IN_STOCK',
  isArchived: false,
};

function LocationProbe() {
  const loc = useLocation();
  const barcode = (loc.state as { barcode?: string } | null)?.barcode ?? '';
  return <div data-testid="loc">{`${loc.pathname}|${barcode}`}</div>;
}

function renderPage(role: 'ADMIN' | 'STAFF' = 'ADMIN') {
  useSettingsStore.getState().setSettings({ currency: 'USD', movementWarningThreshold: 1000 });
  useAuthStore.getState().setSession('token', {
    id: 'u1',
    name: role === 'ADMIN' ? 'Ada Admin' : 'Sam Staff',
    email: 'u@example.com',
    role,
    mustChangePassword: false,
  });
  return render(
    <MemoryRouter initialEntries={['/scanner']}>
      <ScannerPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function lookUp(code: string) {
  await userEvent.type(screen.getByLabelText(/enter a code/i), code);
  await userEvent.click(screen.getByRole('button', { name: /look up/i }));
}

beforeEach(() => vi.clearAllMocks());

describe('Scanner page (F8)', () => {
  it('found → Stock In → records a movement and flashes the updated quantity', async () => {
    mockedLookup.mockResolvedValue(FOUND);
    mockedRecord.mockResolvedValue({
      transaction: {
        id: 't1',
        productId: PID,
        type: 'STOCK_IN',
        quantityChange: 5,
        quantityAfter: 17,
        userId: 'u1',
        createdAt: '2026-07-25T00:00:00.000Z',
      },
      product: { id: PID, quantity: 17, lowStockThreshold: 10, stockStatus: 'IN_STOCK' },
    });
    renderPage('ADMIN');

    await lookUp('ELEC-1');
    const card = await screen.findByRole('region', { name: /scan result/i });
    expect(within(card).getByText('USB-C Cable')).toBeInTheDocument();
    expect(within(card).getByText(/qty 12/i)).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: /^stock in$/i }));
    await userEvent.type(await screen.findByLabelText(/quantity/i), '5');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(mockedRecord).toHaveBeenCalledTimes(1));
    const [body] = mockedRecord.mock.calls[0]!;
    expect(body).toMatchObject({ type: 'STOCK_IN', productId: PID, quantity: 5 });
    // Card stays, flashes, and shows the new quantity (WIR Issue 2a).
    expect(await screen.findByText(/qty 17/i)).toBeInTheDocument();
    expect(
      within(await screen.findByRole('region', { name: /scan result/i })).getByText(
        /stock updated/i,
      ),
    ).toBeInTheDocument();
  });

  it('not-found → Admin gets create-from-code carrying the code as route state', async () => {
    mockedLookup.mockRejectedValue(new ApiError({ code: 'NOT_FOUND', message: 'x', status: 404 }));
    renderPage('ADMIN');

    await lookUp('NOPE-1');
    await userEvent.click(
      await screen.findByRole('button', { name: /create product with this code/i }),
    );

    expect(screen.getByTestId('loc')).toHaveTextContent('/products/new|NOPE-1');
  });

  it('not-found → Staff sees notify-administrator, no create action', async () => {
    mockedLookup.mockRejectedValue(new ApiError({ code: 'NOT_FOUND', message: 'x', status: 404 }));
    renderPage('STAFF');

    await lookUp('NOPE-1');
    expect(await screen.findByText(/notify an administrator/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create product with this code/i }),
    ).not.toBeInTheDocument();
  });

  it('archived → Admin restore turns the card into a movable product', async () => {
    mockedLookup.mockResolvedValue({ ...FOUND, isArchived: true });
    mockedRestore.mockResolvedValue({
      id: PID,
      quantity: 12,
      stockStatus: 'IN_STOCK',
    } as Product);
    renderPage('ADMIN');

    await lookUp('ELEC-1');
    expect(await screen.findByText(/is archived/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^stock in$/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /restore/i }));
    expect(await screen.findByRole('button', { name: /^stock in$/i })).toBeInTheDocument();
  });

  it('server INVALID_BARCODE → the page renders its invalid state', async () => {
    mockedLookup.mockRejectedValue(
      new ApiError({ code: 'INVALID_BARCODE', message: 'x', status: 422 }),
    );
    renderPage('ADMIN');

    await lookUp('WEIRD-1');
    expect(await screen.findByRole('button', { name: /scan again/i })).toBeInTheDocument();
  });
});
