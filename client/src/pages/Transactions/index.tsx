/**
 * Transactions page — WIR §11 / FR-TXN (F7). Two tabs, selected via the URL
 * (`?tab=`, SMP §4): the Stock Ledger (both roles, P3) and the Audit Trail
 * (Admin-only, this phase's slice — gated in-page with usePermission('audit.view')).
 *
 * The Stock Ledger tab: filters (date range · type · include-archived) + a
 * paginated, append-only table of movements; archived-product rows carry a badge
 * (EC-16); a `productId` deep-link (SMP §5) pre-filters. The Audit Trail tab
 * (AuditTrailTab) adds entity/date filters + before/after diff expansion.
 */
import { useCallback, useMemo } from 'react';

import { listTransactions, type TransactionRow } from '../../api/transactions';
import { AuditTrailTab } from '../../components/domain/AuditTrailTab';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type ColumnDef } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { usePermission } from '../../hooks/usePermission';
import { useQueryState } from '../../hooks/useQueryState';
import { useUrlState } from '../../hooks/useUrlState';

const TYPES = ['INITIAL', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const;
type MovementType = (typeof TYPES)[number];

const TYPE_LABELS: Record<MovementType, string> = {
  INITIAL: 'Initial',
  STOCK_IN: 'Stock In',
  STOCK_OUT: 'Stock Out',
  ADJUSTMENT: 'Adjustment',
};

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export default function TransactionsPage() {
  const { get, patch } = useUrlState();
  const can = usePermission();
  const canAudit = can('audit.view');
  const tab = canAudit && get('tab') === 'audit' ? 'audit' : 'ledger';

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Transactions</h1>

      <div
        role="tablist"
        aria-label="Transaction views"
        className="flex gap-1 border-b border-gray-200"
      >
        <button
          role="tab"
          aria-selected={tab === 'ledger'}
          onClick={() => patch({ tab: undefined }, true)}
          className={
            tab === 'ledger'
              ? 'border-b-2 border-brand-600 px-3 py-2 text-sm font-medium text-brand-700'
              : 'px-3 py-2 text-sm text-gray-600 hover:text-gray-900'
          }
        >
          Stock Ledger
        </button>
        {canAudit ? (
          <button
            role="tab"
            aria-selected={tab === 'audit'}
            onClick={() => patch({ tab: 'audit' }, true)}
            className={
              tab === 'audit'
                ? 'border-b-2 border-brand-600 px-3 py-2 text-sm font-medium text-brand-700'
                : 'px-3 py-2 text-sm text-gray-600 hover:text-gray-900'
            }
          >
            Audit Trail
          </button>
        ) : (
          <button
            role="tab"
            aria-selected="false"
            disabled
            title="Audit Trail is Admin-only"
            className="cursor-not-allowed px-3 py-2 text-sm text-gray-400"
          >
            Audit Trail
          </button>
        )}
      </div>

      {tab === 'audit' ? <AuditTrailTab /> : <LedgerTab />}
    </section>
  );
}

function LedgerTab() {
  const { get, getNumber, patch } = useUrlState();

  const page = getNumber('page', 1);
  const from = get('from');
  const to = get('to');
  const typeParam = get('type');
  const type = (TYPES as readonly string[]).includes(typeParam)
    ? (typeParam as MovementType)
    : undefined;
  const productId = get('productId') || undefined;
  const includeArchived = get('includeArchived') === 'true';

  const query = useCallback(
    () =>
      listTransactions({
        page,
        from: from || undefined,
        to: to || undefined,
        type,
        productId,
        includeArchived: includeArchived || undefined,
      }),
    [page, from, to, type, productId, includeArchived],
  );
  const { data, loading, error, refetch } = useQueryState(query, [
    page,
    from,
    to,
    type,
    productId,
    includeArchived,
  ]);

  const columns = useMemo<ColumnDef<TransactionRow>[]>(
    () => [
      {
        key: 'createdAt',
        header: 'Time',
        render: (row) => (
          <span className="whitespace-nowrap text-sm text-gray-600">
            {new Date(row.createdAt).toLocaleString()}
          </span>
        ),
      },
      {
        key: 'product',
        header: 'Product',
        render: (row) => (
          <span className="flex items-center gap-2">
            <span>
              <span className="font-medium text-gray-900">{row.productName}</span>{' '}
              <span className="font-mono text-xs text-gray-500">{row.productSku}</span>
            </span>
            {row.productArchived && <Badge tone="neutral">Archived</Badge>}
          </span>
        ),
      },
      { key: 'type', header: 'Type', render: (row) => TYPE_LABELS[row.type] },
      {
        key: 'quantityChange',
        header: '± Qty',
        align: 'right',
        render: (row) => (
          <span className={row.quantityChange < 0 ? 'text-danger-600' : 'text-gray-900'}>
            {signed(row.quantityChange)}
          </span>
        ),
      },
      { key: 'quantityAfter', header: 'After', align: 'right', render: (row) => row.quantityAfter },
      { key: 'userName', header: 'User', render: (row) => row.userName },
      {
        key: 'reason',
        header: 'Reason / note',
        render: (row) => (
          <span className="text-sm text-gray-600">
            {[row.reason, row.note].filter(Boolean).join(' — ') || (
              <span className="text-gray-400">—</span>
            )}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      {productId && (
        <AlertBanner
          tone="info"
          message="Showing the ledger for a single product."
          action={
            <Button variant="secondary" onClick={() => patch({ productId: undefined }, true)}>
              Clear filter
            </Button>
          }
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-36 text-sm sm:flex-none">
          <span className="mb-1 block text-gray-600">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => patch({ from: e.target.value }, true)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-auto"
          />
        </label>
        <label className="min-w-0 flex-1 basis-36 text-sm sm:flex-none">
          <span className="mb-1 block text-gray-600">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => patch({ to: e.target.value }, true)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-auto"
          />
        </label>
        <label className="min-w-0 flex-1 basis-36 text-sm sm:flex-none">
          <span className="mb-1 block text-gray-600">Type</span>
          <select
            value={type ?? ''}
            onChange={(e) => patch({ type: e.target.value }, true)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-auto"
          >
            <option value="">All types</option>
            {TYPES.map((option) => (
              <option key={option} value={option}>
                {TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 py-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) =>
              patch({ includeArchived: e.target.checked ? 'true' : undefined }, true)
            }
          />
          Include archived
        </label>
      </div>

      {error ? (
        <AlertBanner
          tone="danger"
          message="Couldn't load the ledger."
          action={
            <Button variant="secondary" onClick={refetch}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={data?.data ?? []}
            rowKey={(row) => row.id}
            loading={loading}
            emptyState={<EmptyState message="No movements match these filters." />}
          />
          {data && (
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              totalItems={data.totalItems}
              limit={data.limit}
              onChange={(next) => patch({ page: next })}
            />
          )}
        </>
      )}
    </div>
  );
}
