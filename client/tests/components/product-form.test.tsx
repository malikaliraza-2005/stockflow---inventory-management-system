/**
 * F4 — ProductForm against its contract: create happy path (payload shape),
 * DUPLICATE_SKU inline echo (names the field), and the edit STALE_WRITE banner
 * with input preserved (BR-24 / EC-28).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/products', () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

import { createProduct, updateProduct, type Product } from '../../src/api/products';
import { ApiError } from '../../src/api/client';
import { ProductForm } from '../../src/components/domain/ProductForm';

const mockedCreate = vi.mocked(createProduct);
const mockedUpdate = vi.mocked(updateProduct);

const CATEGORY = { id: '507f1f77bcf86cd799439011', name: 'Electronics', isSystem: false };

const PRODUCT: Product = {
  id: '507f191e810c19729de860ea',
  name: 'Widget',
  sku: 'ELEC-00001',
  categoryId: CATEGORY.id,
  quantity: 5,
  lowStockThreshold: 10,
  costPrice: '10.00',
  sellingPrice: '15.00',
  stockStatus: 'LOW_STOCK',
  images: [],
  isArchived: false,
  version: 2,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

describe('ProductForm (create)', () => {
  it('submits the catalog payload (SKU blank = auto)', async () => {
    mockedCreate.mockResolvedValue(PRODUCT);
    const onSaved = vi.fn();
    render(
      <ProductForm mode="create" categories={[CATEGORY]} onSaved={onSaved} onCancel={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText(/^name/i), 'Widget');
    await userEvent.type(screen.getByLabelText(/cost price/i), '10.00');
    await userEvent.type(screen.getByLabelText(/selling price/i), '15.00');
    await userEvent.click(screen.getByRole('button', { name: /save product/i }));

    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Widget',
        categoryId: CATEGORY.id, // defaulted to the only category
        costPrice: '10.00',
        sellingPrice: '15.00',
        initialQuantity: 0,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(PRODUCT);
  });

  it('maps DUPLICATE_SKU to an inline SKU error', async () => {
    mockedCreate.mockRejectedValue(
      new ApiError({ code: 'DUPLICATE_SKU', message: 'dup', status: 409 }),
    );
    render(
      <ProductForm mode="create" categories={[CATEGORY]} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText(/^name/i), 'Widget');
    await userEvent.type(screen.getByLabelText(/^sku/i), 'ELEC-00001');
    await userEvent.type(screen.getByLabelText(/cost price/i), '10.00');
    await userEvent.type(screen.getByLabelText(/selling price/i), '15.00');
    await userEvent.click(screen.getByRole('button', { name: /save product/i }));

    expect(await screen.findByText(/sku already exists/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^sku/i)).toHaveValue('ELEC-00001'); // preserved
  });
});

describe('ProductForm (edit)', () => {
  it('shows a STALE_WRITE banner with a Reload and preserves input (BR-24)', async () => {
    mockedUpdate.mockRejectedValue(
      new ApiError({ code: 'STALE_WRITE', message: 'stale', status: 409 }),
    );
    const onReload = vi.fn();
    render(
      <ProductForm
        mode="edit"
        product={PRODUCT}
        categories={[CATEGORY]}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        onReload={onReload}
      />,
    );

    const nameInput = screen.getByLabelText(/^name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed Widget');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/changed since you opened it/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toHaveValue('Renamed Widget'); // preserved
    expect(screen.getByLabelText(/^sku/i)).toBeDisabled(); // immutable (BR-03)

    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalled();
  });
});
