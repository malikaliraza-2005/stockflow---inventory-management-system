/**
 * StockAlertList — WIR §4 (F9). The dashboard's low/out-of-stock preview. Each
 * row links to the product AND offers a `[+]` pre-filled Stock In (FR-DASH-04) —
 * the deep-link into the movement flow. The low variant shows "qty / threshold";
 * the out variant just names the product. `count` is the true total (the list
 * itself is a capped preview — the full list is the F10 low-stock report).
 *
 * The `[+]` is shown only when the viewer can record a movement
 * (movements.stockInOut, both roles) — Staff see it too (Stock In is theirs).
 */
import { Link } from 'react-router-dom';

import type { DashboardAlertItem } from '../../api/dashboard';
import { Button } from '../ui/Button';

export interface StockAlertListProps {
  title: string;
  variant: 'low' | 'out';
  count: number;
  items: DashboardAlertItem[];
  canStockIn: boolean;
  onStockIn: (item: DashboardAlertItem) => void;
}

export function StockAlertList({
  title,
  variant,
  count,
  items,
  canStockIn,
  onStockIn,
}: StockAlertListProps) {
  const emptyMessage = variant === 'low' ? 'No low-stock items.' : 'Nothing out of stock.';

  return (
    <section aria-label={title} className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-900">
        {title} <span className="font-normal text-gray-500">({count})</span>
      </h2>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 py-2">
              <Link
                to={`/products/${item.id}`}
                className="min-w-0 flex-1 truncate text-sm text-brand-700 hover:underline"
              >
                <span className="font-medium">{item.name}</span>{' '}
                <span className="font-mono text-xs text-gray-500">{item.sku}</span>
              </Link>
              {variant === 'low' && (
                <span className="whitespace-nowrap text-xs text-gray-600">
                  {item.quantity} / {item.lowStockThreshold}
                </span>
              )}
              {canStockIn && (
                <Button
                  variant="secondary"
                  aria-label={`Stock in ${item.name}`}
                  className="!px-2 !py-1"
                  onClick={() => onStockIn(item)}
                >
                  +
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
