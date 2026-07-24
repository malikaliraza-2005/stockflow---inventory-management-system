/**
 * ProductRowCard — UCA §5 (domain, F4). The mobile (< 768) renderer for a
 * product row in DataTable.mobileCard: thumbnail, name, SKU, qty + status. The
 * row-action menu is rendered by DataTable itself, not here.
 */
import type { ProductRow } from '../../api/products';
import { StockStatusBadge } from './StockStatusBadge';

export function ProductRowCard({ product }: { product: ProductRow }) {
  return (
    <div className="flex items-start gap-3">
      {product.thumbnailUrl ? (
        <img
          src={product.thumbnailUrl}
          alt=""
          className="h-12 w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400"
          aria-hidden="true"
        >
          ▣
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium text-gray-900">{product.name}</p>
          <StockStatusBadge status={product.stockStatus} isArchived={product.isArchived} />
        </div>
        <p className="font-mono text-xs text-gray-500">{product.sku}</p>
        <p className="mt-1 text-sm text-gray-600">
          {product.categoryName ?? '—'} · Qty {product.quantity}
        </p>
      </div>
    </div>
  );
}
