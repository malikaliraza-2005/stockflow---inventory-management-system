/**
 * F8 — ScanResultCard variants (WIR §9). found / not-found / archived, each with
 * role-dependent CTAs; the post-movement flash shows the updated quantity and
 * the card stays ready for the next scan.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ScanResultCard, type ScanResult } from '../../src/components/domain/ScanResultCard';
import type { ProductLookup } from '../../src/api/products';

const PRODUCT: ProductLookup = {
  id: 'p1',
  name: 'USB-C Cable',
  sku: 'ELEC-1',
  quantity: 12,
  stockStatus: 'IN_STOCK',
  isArchived: false,
};

function handlers() {
  return {
    onStockIn: vi.fn(),
    onStockOut: vi.fn(),
    onAdjust: vi.fn(),
    onView: vi.fn(),
    onRestore: vi.fn(),
    onCreateProduct: vi.fn(),
    onScanNext: vi.fn(),
  };
}

function renderCard(
  result: ScanResult,
  gates: Partial<Record<string, boolean>> = {},
  flash = false,
) {
  const h = handlers();
  render(
    <ScanResultCard
      result={result}
      canAdjust={gates.canAdjust ?? false}
      canCreateProduct={gates.canCreateProduct ?? false}
      canRestore={gates.canRestore ?? false}
      flash={flash}
      {...h}
    />,
  );
  return h;
}

describe('ScanResultCard — found', () => {
  it('renders name, quantity, status and the movement CTAs', async () => {
    const h = renderCard({ kind: 'found', product: PRODUCT }, { canAdjust: true });
    expect(screen.getByText('USB-C Cable')).toBeInTheDocument();
    expect(screen.getByText(/qty 12/i)).toBeInTheDocument();
    expect(screen.getByText(/in stock/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^stock in$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^stock out$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^adjust$/i }));
    expect(h.onStockIn).toHaveBeenCalledTimes(1);
    expect(h.onStockOut).toHaveBeenCalledTimes(1);
    expect(h.onAdjust).toHaveBeenCalledTimes(1);
  });

  it('hides Adjust when the role lacks movements.adjust', () => {
    renderCard({ kind: 'found', product: PRODUCT }, { canAdjust: false });
    expect(screen.queryByRole('button', { name: /^adjust$/i })).not.toBeInTheDocument();
  });

  it('shows the post-movement success flash with the updated quantity', () => {
    renderCard({ kind: 'found', product: { ...PRODUCT, quantity: 17 } }, { canAdjust: true }, true);
    expect(screen.getByText(/stock updated/i)).toBeInTheDocument();
    expect(screen.getByText(/qty 17/i)).toBeInTheDocument();
  });
});

describe('ScanResultCard — not-found (FR-SCAN-04)', () => {
  it('Admin sees create-from-code; the code is shown escaped', async () => {
    const h = renderCard({ kind: 'not-found', code: '<x>' }, { canCreateProduct: true });
    expect(screen.getByText('<x>')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create product with this code/i }));
    expect(h.onCreateProduct).toHaveBeenCalledTimes(1);
  });

  it('Staff sees the notify-administrator message, no create action', () => {
    renderCard({ kind: 'not-found', code: 'ZZZ' }, { canCreateProduct: false });
    expect(screen.getByText(/notify an administrator/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create product with this code/i }),
    ).not.toBeInTheDocument();
  });
});

describe('ScanResultCard — archived (FR-SCAN-05 / BR-07)', () => {
  const archived: ScanResult = {
    kind: 'archived',
    product: { ...PRODUCT, isArchived: true },
  };

  it('reports archived, suppresses movement actions, offers Restore to Admin', async () => {
    const h = renderCard(archived, { canRestore: true });
    expect(screen.getByText(/is archived/i)).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument(); // the status badge
    expect(screen.queryByRole('button', { name: /^stock in$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^adjust$/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /restore/i }));
    expect(h.onRestore).toHaveBeenCalledTimes(1);
  });

  it('hides Restore when the role lacks products.lifecycle', () => {
    renderCard(archived, { canRestore: false });
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
  });
});
