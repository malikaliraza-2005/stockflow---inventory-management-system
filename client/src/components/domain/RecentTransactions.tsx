/**
 * RecentTransactions — WIR §4 (F9). The 10 most recent ledger rows as a compact
 * activity feed; each row deep-links to the Stock Ledger filtered to its product
 * (`/transactions?productId=…`, SMP §5). Rows are the SAME shape the ledger tab
 * renders (TransactionRow) so the two never diverge. Presentational — the data
 * is fetched once by the Dashboard's single aggregate call.
 */
import { Link } from 'react-router-dom';

import type { TransactionRow } from '../../api/transactions';
import { formatDateTime } from '../../lib/formatters';

const TYPE_LABELS: Record<TransactionRow['type'], string> = {
  INITIAL: 'Initial',
  STOCK_IN: 'Stock In',
  STOCK_OUT: 'Stock Out',
  ADJUSTMENT: 'Adjustment',
};

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export interface RecentTransactionsProps {
  rows: TransactionRow[];
}

export function RecentTransactions({ rows }: RecentTransactionsProps) {
  return (
    <section
      aria-label="Recent transactions"
      className="rounded-lg border border-gray-200 bg-white p-4"
    >
      <h2 className="mb-2 text-sm font-semibold text-gray-900">Recent transactions</h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="whitespace-nowrap text-xs text-gray-500">
                {formatDateTime(row.createdAt)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-gray-500">{TYPE_LABELS[row.type]}</span>{' '}
                <Link
                  to={`/transactions?productId=${row.productId}`}
                  className="text-brand-700 hover:underline"
                >
                  {row.productName}
                </Link>
              </span>
              <span
                className={
                  row.quantityChange < 0
                    ? 'whitespace-nowrap text-danger-600'
                    : 'whitespace-nowrap text-gray-900'
                }
              >
                {signed(row.quantityChange)}
              </span>
              <span className="hidden whitespace-nowrap text-xs text-gray-500 sm:inline">
                {row.userName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
