/**
 * Dashboard page — WIR §4 / FR-DASH-01…04 (F9). The analytical landing: three
 * KPIs, low/out-of-stock alerts, both charts, the 10 most recent movements, and
 * two quick actions. Everything comes from ONE cached aggregate call
 * (getDashboardSummary, FR-DASH-03); the selected range lives in the URL
 * (`?range=`, SMP §4) so the view survives refresh and sharing.
 *
 * `asOf` is surfaced verbatim (BR-25 honest staleness). The ChartPanel is
 * React.lazy so the Recharts bundle stays out of the initial paint (NFR-06) and
 * hydrates after the shell behind a skeleton. Quick actions reuse F6's dialogs:
 * `[New movement]` opens the movement dialog context-free (Step 0 ProductPicker);
 * an alert `[+]` opens it pre-filled with that product for a Stock In (FR-DASH-04).
 */
import { Suspense, lazy, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  DASHBOARD_RANGES,
  getDashboardSummary,
  type DashboardAlertItem,
  type DashboardRange,
} from '../../api/dashboard';
import { RecentTransactions } from '../../components/domain/RecentTransactions';
import { StockAlertList } from '../../components/domain/StockAlertList';
import { StockMovementDialog } from '../../components/domain/StockMovementDialog';
import type { PickedProduct } from '../../components/domain/ProductPicker';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { KpiCard } from '../../components/ui/KpiCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { usePermission } from '../../hooks/usePermission';
import { useQueryState } from '../../hooks/useQueryState';
import { useToast } from '../../hooks/useToast';
import { useUrlState } from '../../hooks/useUrlState';
import { formatDateTime, formatMoney } from '../../lib/formatters';
import { selectCurrency, useSettingsStore } from '../../stores/settingsStore';

const ChartPanel = lazy(() => import('../../components/domain/ChartPanel'));

function normalizeRange(value: number): DashboardRange {
  return (DASHBOARD_RANGES as readonly number[]).includes(value) ? (value as DashboardRange) : 30;
}

export default function DashboardPage() {
  const { getNumber, patch } = useUrlState();
  const range = normalizeRange(getNumber('range', 30));

  const currency = useSettingsStore(selectCurrency);
  const can = usePermission();
  const canStockIn = can('movements.stockInOut');
  const navigate = useNavigate();
  const toast = useToast();

  const query = useCallback(() => getDashboardSummary(range), [range]);
  const { data, loading, error, refetch } = useQueryState(query, [range]);

  // One controlled movement dialog serves both the `[+]` alerts (with a product)
  // and `[New movement]` (context-free — Step 0 picker). null ⇒ closed.
  const [movementProduct, setMovementProduct] = useState<PickedProduct | null | undefined>(
    undefined,
  );
  const dialogOpen = movementProduct !== undefined;

  const openStockIn = (item: DashboardAlertItem) =>
    setMovementProduct({
      id: item.id,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
    });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-3">
          <div
            role="group"
            aria-label="Chart range"
            className="flex overflow-hidden rounded-md border border-gray-300"
          >
            {DASHBOARD_RANGES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={range === option}
                onClick={() => patch({ range: option === 30 ? undefined : String(option) })}
                className={`px-3 py-1.5 text-sm ${
                  range === option
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {option}d
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-500">
            {data ? `as of ${formatDateTime(data.asOf)}` : ''}
          </span>
        </div>
      </div>

      {error ? (
        <AlertBanner
          tone="danger"
          message="Couldn't load the dashboard."
          action={
            <Button variant="secondary" onClick={refetch}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              label="Total products"
              value={data?.totals.activeProducts ?? 0}
              loading={loading}
            />
            <KpiCard
              label="Inventory value"
              value={data ? formatMoney(data.totals.inventoryValue, currency) : '—'}
              loading={loading}
            />
            <KpiCard
              label="Units in stock"
              value={data?.totals.unitsInStock ?? 0}
              loading={loading}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <StockAlertList
              title="Low stock"
              variant="low"
              count={data?.lowStock.count ?? 0}
              items={data?.lowStock.items ?? []}
              canStockIn={canStockIn}
              onStockIn={openStockIn}
            />
            <StockAlertList
              title="Out of stock"
              variant="out"
              count={data?.outOfStock.count ?? 0}
              items={data?.outOfStock.items ?? []}
              canStockIn={canStockIn}
              onStockIn={openStockIn}
            />
          </div>

          {data && (
            <Suspense fallback={<Skeleton variant="card" className="h-56" />}>
              <ChartPanel
                movementTrend={data.charts.movementTrend}
                transactionVolume={data.charts.transactionVolume}
              />
            </Suspense>
          )}

          <RecentTransactions rows={data?.recentTransactions ?? []} />

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => navigate('/scanner')}>
              Scan
            </Button>
            {canStockIn && <Button onClick={() => setMovementProduct(null)}>New movement</Button>}
          </div>
        </>
      )}

      <StockMovementDialog
        open={dialogOpen}
        onClose={() => setMovementProduct(undefined)}
        product={movementProduct ?? undefined}
        defaultType="STOCK_IN"
        onCompleted={() => {
          setMovementProduct(undefined);
          toast.success('Stock updated.');
          refetch();
        }}
      />
    </section>
  );
}
