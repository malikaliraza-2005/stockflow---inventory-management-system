/**
 * F4 — Products page: list render with status badges + prices, and the
 * Admin-only archived filter surfacing. Uses an ADMIN session so the manage
 * controls render.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/products', () => ({ listProducts: vi.fn() }));
vi.mock('../../src/api/categories', () => ({ listCategories: vi.fn() }));

import { listProducts } from '../../src/api/products';
import { listCategories } from '../../src/api/categories';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import ProductsPage from '../../src/pages/Products';

const mockedList = vi.mocked(listProducts);
const mockedCategories = vi.mocked(listCategories);

const ROWS = [
  {
    id: 'p1',
    name: 'USB-C Cable',
    sku: 'ELEC-00001',
    categoryName: 'Electronics',
    quantity: 3,
    lowStockThreshold: 10,
    stockStatus: 'LOW_STOCK' as const,
    costPrice: '2.00',
    sellingPrice: '5.00',
    isArchived: false,
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/products']}>
      <ProductsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue({ data: ROWS, page: 1, limit: 20, totalItems: 1, totalPages: 1 });
  mockedCategories.mockResolvedValue({
    data: [],
    page: 1,
    limit: 100,
    totalItems: 0,
    totalPages: 0,
  });
  useSettingsStore.getState().setSettings({ currency: 'USD', movementWarningThreshold: 1000 });
  useAuthStore.getState().setSession('token', {
    id: 'admin',
    name: 'Ada Admin',
    email: 'ada@example.com',
    role: 'ADMIN',
    mustChangePassword: false,
  });
});

describe('Products page (FR-PROD-05)', () => {
  it('renders product rows with status badge and formatted prices', async () => {
    renderPage();
    expect(await screen.findAllByText('USB-C Cable')).not.toHaveLength(0);
    expect(screen.getAllByText(/low stock/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$2\.00 \/ \$5\.00/).length).toBeGreaterThan(0);
  });

  it('exposes the Admin archived filter and the Add control', async () => {
    renderPage();
    await screen.findAllByText('USB-C Cable');
    expect(screen.getByLabelText(/show archived/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add product/i })).toBeInTheDocument();
  });
});
