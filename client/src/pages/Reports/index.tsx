/**
 * Reports page — WIR §12 / FR-RPT-01…06 (F10). One page, five reports selected
 * by a URL param (`?type=`, SMP §4). Each report has its own filter panel:
 * transactions/performance take a MANDATORY date range pre-filled to the last 30
 * days (≤ 366 d, server-enforced); inventory takes category + status. Historical
 * reports are ledger-derived (BR-40); a footnote states the timezone and that
 * values use current cost (FR-RPT-06).
 *
 * The Consistency report and CSV export are Admin-only — gated in-page
 * (reports.consistency / reports.export) AND at the API (403). Export streams the
 * full filtered dataset; a mid-stream server abort rejects the download and we
 * show the ERR §7 retry toast.
 */
import { useCallback, useState } from 'react';

import { listCategories, type Category } from '../../api/categories';
import {
  exportReport,
  getConsistencyReport,
  getInventoryReport,
  getLowStockReport,
  getProductPerformanceReport,
  getTransactionsReport,
  REPORT_TYPES,
  type ConsistencyRow,
  type InventoryReport,
  type LowStockReportRow,
  type ProductPerformanceReport,
  type ReportList,
  type ReportType,
} from '../../api/reports';
import type { TransactionRow } from '../../api/transactions';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type ColumnDef } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { usePermission } from '../../hooks/usePermission';
import { useQueryState } from '../../hooks/useQueryState';
import { useToast } from '../../hooks/useToast';
import { useUrlState } from '../../hooks/useUrlState';
import { formatDateTime, formatMoney } from '../../lib/formatters';
import { selectCurrency, useSettingsStore } from '../../stores/settingsStore';

const LABELS: Record<ReportType, string> = {
  inventory: 'Inventory',
  'low-stock': 'Low stock',
  transactions: 'Transactions',
  'product-performance': 'Performance',
  consistency: 'Consistency',
};

const STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;
type StockStatus = (typeof STOCK_STATUSES)[number];

const MOVEMENT_TYPES = ['INITIAL', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** The discriminated result of the active report's fetch. */
type Fetched =
  | { kind: 'inventory'; env: InventoryReport }
  | { kind: 'low-stock'; env: ReportList<LowStockReportRow> }
  | { kind: 'transactions'; env: ReportList<TransactionRow> }
  | { kind: 'product-performance'; env: ProductPerformanceReport }
  | { kind: 'consistency'; env: ReportList<ConsistencyRow> };

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { get, getNumber, patch } = useUrlState();
  const can = usePermission();
  const currency = useSettingsStore(selectCurrency);
  const toast = useToast();

  const visibleTypes = REPORT_TYPES.filter(
    (t) => t !== 'consistency' || can('reports.consistency'),
  );
  const requested = get('type');
  const type: ReportType = (visibleTypes as readonly string[]).includes(requested)
    ? (requested as ReportType)
    : 'inventory';

  const page = getNumber('page', 1);
  const categoryId = get('categoryId') || undefined;
  const statusParam = get('stockStatus');
  const stockStatus = (STOCK_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as StockStatus)
    : undefined;
  const mvTypeParam = get('mvType');
  const mvType = (MOVEMENT_TYPES as readonly string[]).includes(mvTypeParam)
    ? (mvTypeParam as MovementType)
    : undefined;
  const from = get('from') || isoDaysAgo(30);
  const to = get('to') || isoDaysAgo(0);

  const needsDateRange = type === 'transactions' || type === 'product-performance';

  // Categories drive the inventory filter dropdown (fetched once).
  const { data: categories } = useQueryState<Category[]>(
    useCallback(
      () => listCategories({ limit: 100, sort: 'name', order: 'asc' }).then((r) => r.data),
      [],
    ),
    [],
  );

  const fetcher = useCallback(async (): Promise<Fetched> => {
    switch (type) {
      case 'inventory':
        return {
          kind: 'inventory',
          env: await getInventoryReport({ page, categoryId, stockStatus }),
        };
      case 'low-stock':
        return { kind: 'low-stock', env: await getLowStockReport({ page }) };
      case 'transactions':
        return {
          kind: 'transactions',
          env: await getTransactionsReport({ page, from, to, type: mvType }),
        };
      case 'product-performance':
        return {
          kind: 'product-performance',
          env: await getProductPerformanceReport({ page, from, to }),
        };
      case 'consistency':
        return { kind: 'consistency', env: await getConsistencyReport({ page }) };
    }
  }, [type, page, categoryId, stockStatus, mvType, from, to]);

  const { data, loading, error, refetch } = useQueryState(fetcher, [
    type,
    page,
    categoryId,
    stockStatus,
    mvType,
    from,
    to,
  ]);

  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const params: Record<string, string | number | undefined> = needsDateRange
        ? { from, to, ...(type === 'transactions' ? { type: mvType } : {}) }
        : type === 'inventory'
          ? { categoryId, stockStatus }
          : {};
      const blob = await exportReport(type, params);
      downloadBlob(blob, `${type}-report.csv`);
    } catch {
      // ERR §7: a destroyed mid-stream download rejects here → retry toast.
      toast.error('Download failed — please retry.');
    } finally {
      setExporting(false);
    }
  }

  const env = data?.env;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
        {can('reports.export') && (
          <Button variant="secondary" loading={exporting} onClick={() => void handleExport()}>
            Export CSV
          </Button>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Report"
        className="flex flex-wrap gap-1 border-b border-gray-200"
      >
        {visibleTypes.map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={type === option}
            onClick={() =>
              patch({ type: option === 'inventory' ? undefined : option, page: undefined })
            }
            className={
              type === option
                ? 'border-b-2 border-brand-600 px-3 py-2 text-sm font-medium text-brand-700'
                : 'px-3 py-2 text-sm text-gray-600 hover:text-gray-900'
            }
          >
            {LABELS[option]}
          </button>
        ))}
      </div>

      <FilterPanel
        type={type}
        categories={categories ?? []}
        categoryId={categoryId}
        stockStatus={stockStatus}
        mvType={mvType}
        from={from}
        to={to}
        onChange={(updates) => patch(updates, true)}
      />

      {error ? (
        <AlertBanner
          tone="danger"
          message="Couldn't run the report."
          action={
            <Button variant="secondary" onClick={refetch}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          {data && <ReportTable data={data} currency={currency} loading={loading} />}
          {!data && (
            <DataTable columns={[]} rows={[]} rowKey={() => ''} loading emptyState={null} />
          )}

          <p className="text-xs text-gray-500">
            Times shown in your local timezone. Monetary values use current cost (FR-RPT-06).
          </p>

          {env && (
            <Pagination
              page={env.page}
              totalPages={env.totalPages}
              totalItems={env.totalItems}
              limit={env.limit}
              onChange={(next) => patch({ page: next })}
            />
          )}
        </>
      )}
    </section>
  );
}

// ── Filter panel ─────────────────────────────────────────────────────────────

interface FilterPanelProps {
  type: ReportType;
  categories: Category[];
  categoryId: string | undefined;
  stockStatus: StockStatus | undefined;
  mvType: MovementType | undefined;
  from: string;
  to: string;
  onChange: (updates: Record<string, string | undefined>) => void;
}

function FilterPanel(props: FilterPanelProps) {
  const { type, categories, categoryId, stockStatus, mvType, from, to, onChange } = props;
  if (type === 'low-stock' || type === 'consistency') return null;

  return (
    <div className="flex flex-wrap items-end gap-3">
      {type === 'inventory' && (
        <>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Category</span>
            <select
              value={categoryId ?? ''}
              onChange={(e) => onChange({ categoryId: e.target.value || undefined })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Status</span>
            <select
              value={stockStatus ?? ''}
              onChange={(e) => onChange({ stockStatus: e.target.value || undefined })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              <option value="IN_STOCK">In stock</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="OUT_OF_STOCK">Out of stock</option>
            </select>
          </label>
        </>
      )}

      {(type === 'transactions' || type === 'product-performance') && (
        <>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => onChange({ from: e.target.value || undefined })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => onChange({ to: e.target.value || undefined })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </>
      )}

      {type === 'transactions' && (
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Type</span>
          <select
            value={mvType ?? ''}
            onChange={(e) => onChange({ mvType: e.target.value || undefined })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// ── Report table (per-kind columns + totals row) ────────────────────────────

interface ReportTableProps {
  data: Fetched;
  currency: string | null;
  loading: boolean;
}

function ReportTable({ data, currency, loading }: ReportTableProps) {
  const empty = <EmptyState message="No rows for these filters." />;

  switch (data.kind) {
    case 'inventory': {
      const columns: ColumnDef<InventoryReport['data'][number]>[] = [
        {
          key: 'sku',
          header: 'SKU',
          render: (r) => <span className="font-mono text-xs">{r.sku}</span>,
        },
        { key: 'name', header: 'Name', render: (r) => r.name },
        { key: 'categoryName', header: 'Category', render: (r) => r.categoryName },
        { key: 'quantity', header: 'Qty', align: 'right', render: (r) => r.quantity },
        {
          key: 'costPrice',
          header: 'Cost',
          align: 'right',
          render: (r) => formatMoney(r.costPrice, currency),
        },
        {
          key: 'lineValue',
          header: 'Line value',
          align: 'right',
          render: (r) => formatMoney(r.lineValue, currency),
        },
        {
          key: 'status',
          header: 'Status',
          render: (r) => <Badge tone="neutral">{r.stockStatus}</Badge>,
        },
      ];
      return (
        <>
          <DataTable
            columns={columns}
            rows={data.env.data}
            rowKey={(r) => r.id}
            loading={loading}
            emptyState={empty}
          />
          <p className="text-sm font-medium text-gray-700">
            Totals: {data.env.totals.totalQuantity} units ·{' '}
            {formatMoney(data.env.totals.totalValue, currency)}
          </p>
        </>
      );
    }
    case 'low-stock': {
      const columns: ColumnDef<LowStockReportRow>[] = [
        {
          key: 'sku',
          header: 'SKU',
          render: (r) => <span className="font-mono text-xs">{r.sku}</span>,
        },
        { key: 'name', header: 'Name', render: (r) => r.name },
        { key: 'categoryName', header: 'Category', render: (r) => r.categoryName },
        { key: 'quantity', header: 'Qty', align: 'right', render: (r) => r.quantity },
        {
          key: 'lowStockThreshold',
          header: 'Threshold',
          align: 'right',
          render: (r) => r.lowStockThreshold,
        },
        { key: 'shortage', header: 'Shortage', align: 'right', render: (r) => r.shortage },
      ];
      return (
        <DataTable
          columns={columns}
          rows={data.env.data}
          rowKey={(r) => r.id}
          loading={loading}
          emptyState={empty}
        />
      );
    }
    case 'transactions': {
      const columns: ColumnDef<TransactionRow>[] = [
        { key: 'createdAt', header: 'Time', render: (r) => formatDateTime(r.createdAt) },
        {
          key: 'product',
          header: 'Product',
          render: (r) => (
            <span>
              {r.productName}{' '}
              <span className="font-mono text-xs text-gray-500">{r.productSku}</span>
            </span>
          ),
        },
        { key: 'type', header: 'Type', render: (r) => r.type },
        {
          key: 'quantityChange',
          header: '± Qty',
          align: 'right',
          render: (r) => signed(r.quantityChange),
        },
        { key: 'quantityAfter', header: 'After', align: 'right', render: (r) => r.quantityAfter },
        { key: 'userName', header: 'User', render: (r) => r.userName },
      ];
      return (
        <DataTable
          columns={columns}
          rows={data.env.data}
          rowKey={(r) => r.id}
          loading={loading}
          emptyState={empty}
        />
      );
    }
    case 'product-performance': {
      const columns: ColumnDef<ProductPerformanceReport['data'][number]>[] = [
        {
          key: 'sku',
          header: 'SKU',
          render: (r) => <span className="font-mono text-xs">{r.productSku}</span>,
        },
        { key: 'name', header: 'Product', render: (r) => r.productName },
        { key: 'in', header: 'In', align: 'right', render: (r) => r.in },
        { key: 'out', header: 'Out', align: 'right', render: (r) => r.out },
        { key: 'net', header: 'Net', align: 'right', render: (r) => signed(r.net) },
      ];
      return (
        <>
          <DataTable
            columns={columns}
            rows={data.env.data}
            rowKey={(r) => r.productId}
            loading={loading}
            emptyState={empty}
          />
          <p className="text-sm font-medium text-gray-700">
            Totals: In {data.env.totals.totalIn} · Out {data.env.totals.totalOut} · Net{' '}
            {signed(data.env.totals.totalNet)}
          </p>
        </>
      );
    }
    case 'consistency': {
      const columns: ColumnDef<ConsistencyRow>[] = [
        {
          key: 'sku',
          header: 'SKU',
          render: (r) => <span className="font-mono text-xs">{r.productSku}</span>,
        },
        { key: 'name', header: 'Product', render: (r) => r.productName },
        { key: 'ledgerSum', header: 'Ledger sum', align: 'right', render: (r) => r.ledgerSum },
        { key: 'quantity', header: 'Quantity', align: 'right', render: (r) => r.quantity },
        {
          key: 'drift',
          header: 'Drift',
          render: (r) =>
            r.drift ? <Badge tone="danger">Drift</Badge> : <Badge tone="success">OK</Badge>,
        },
      ];
      return (
        <DataTable
          columns={columns}
          rows={data.env.data}
          rowKey={(r) => r.productId}
          loading={loading}
          emptyState={empty}
        />
      );
    }
  }
}
