/**
 * F6 — StockMovementDialog against its contract: happy-path submit calls the
 * movement API with the idempotency key and reports the result; BR-11
 * INSUFFICIENT_STOCK renders the server `available` inline; a retry after a
 * network failure reuses the SAME idempotency key (ARB-02).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/movements', () => ({ recordMovement: vi.fn() }));

import { ApiError } from '../../src/api/client';
import { recordMovement } from '../../src/api/movements';
import { StockMovementDialog } from '../../src/components/domain/StockMovementDialog';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedRecord = vi.mocked(recordMovement);

const PRODUCT = { id: '507f1f77bcf86cd799439011', name: 'USB Cable', sku: 'ELEC-1', quantity: 20 };

function result(quantityAfter: number) {
  return {
    transaction: {
      id: 't1',
      productId: PRODUCT.id,
      type: 'STOCK_IN' as const,
      quantityChange: 5,
      quantityAfter,
      userId: 'u1',
      createdAt: '2026-07-25T00:00:00.000Z',
    },
    product: {
      id: PRODUCT.id,
      quantity: quantityAfter,
      lowStockThreshold: 10,
      stockStatus: 'IN_STOCK' as const,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.getState().setSettings({ movementWarningThreshold: 1000 });
});

function renderDialog(onCompleted = vi.fn()) {
  render(
    <StockMovementDialog
      open
      product={PRODUCT}
      defaultType="STOCK_IN"
      onClose={vi.fn()}
      onCompleted={onCompleted}
    />,
  );
  return onCompleted;
}

describe('StockMovementDialog (F6)', () => {
  it('submits a stock-in with an idempotency key and reports the result', async () => {
    mockedRecord.mockResolvedValue(result(25));
    const onCompleted = renderDialog();

    await userEvent.type(screen.getByLabelText(/quantity/i), '5');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(mockedRecord).toHaveBeenCalledTimes(1));
    const [body, key] = mockedRecord.mock.calls[0]!;
    expect(body).toMatchObject({ type: 'STOCK_IN', productId: PRODUCT.id, quantity: 5 });
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('renders the server-authoritative available on INSUFFICIENT_STOCK (BR-11)', async () => {
    mockedRecord.mockRejectedValue(
      new ApiError({
        code: 'INSUFFICIENT_STOCK',
        message: 'Only 3 units available.',
        status: 409,
        details: { available: 3, requested: 5 },
      }),
    );
    renderDialog();

    await userEvent.type(screen.getByLabelText(/quantity/i), '5');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/only 3 available/i)).toBeInTheDocument();
  });

  it('reuses the same idempotency key across a retry after failure (ARB-02)', async () => {
    mockedRecord
      .mockRejectedValueOnce(new ApiError({ code: 'NETWORK_ERROR', message: 'x', status: 0 }))
      .mockResolvedValueOnce(result(25));
    renderDialog();

    await userEvent.type(screen.getByLabelText(/quantity/i), '5');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(mockedRecord).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(mockedRecord).toHaveBeenCalledTimes(2));

    expect(mockedRecord.mock.calls[0]![1]).toBe(mockedRecord.mock.calls[1]![1]); // same key
  });
});
