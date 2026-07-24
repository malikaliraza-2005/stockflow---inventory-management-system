/**
 * Products page — WIR §5 / FR-PROD-05 (F4). Any role views; Admin manages.
 * DataTable + filters (search, category, stock status, archived) over the
 * list; filters/search/sort/page live in the URL (SMP §4). Row actions: View,
 * Edit (Admin). Lifecycle actions (archive/restore/delete) live on the detail
 * page. Movement actions (stock in/out/adjust) arrive with F6.
 * `archived` filter is Admin-only (APD-02).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listCategories, type Category } from '../../api/categories';
import { listProducts, type ProductRow } from '../../api/products';
import { ProductRowCard } from '../../components/domain/ProductRowCard';
import { StockStatusBadge } from '../../components/domain/StockStatusBadge';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { DataTable, type ColumnDef, type RowAction } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { SearchInput } from '../../components/ui/SearchInput';
import { usePermission } from '../../hooks/usePermission';
import { useQueryState } from '../../hooks/useQueryState';
import { useUrlState } from '../../hooks/useUrlState';
import { formatMoney } from '../../lib/formatters';
import { selectCurrency, useSettingsStore } from '../../stores/settingsStore';

const SORTABLE = new Set(['name', 'sku', 'quantity', 'costPrice', 'createdAt']);

export default function ProductsPage() {
  const { get, getNumber, patch } = useUrlState();
  const navigate = useNavigate();
  const can = usePermission();
  const canManage = can('products.manage');
  const currency = useSettingsStore(selectCurrency);

  const page = getNumber('page', 1);
  const search = get('search');
  const categoryId = get('categoryId');
  const stockStatus = get('stockStatus');
  const archived = get('archived') === 'true';
  const sort = get('sort', 'createdAt');
  const order = (get('order', 'desc') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';

  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    void listCategories({ limit: 100, sort: 'name', order: 'asc' }).then((r) =>
      setCategories(r.data),
    );
  }, []);

  const query = useCallback(
    () =>
      listProducts({
        page,
        search: search || undefined,
        categoryId: categoryId || undefined,
        stockStatus: (stockStatus || undefined) as 'in' | 'low' | 'out' | undefined,
        archived: canManage && archived ? true : undefined,
        sort: sort as 'name' | 'sku' | 'quantity' | 'costPrice' | 'createdAt',
        order,
      }),
    [page, search, categoryId, stockStatus, archived, canManage, sort, order],
  );
  const { data, loading, error, refetch } = useQueryState(query, [
    page,
    search,
    categoryId,
    stockStatus,
    archived,
    sort,
    order,
  ]);

  function onSortChange(key: string) {
    if (!SORTABLE.has(key)) return;
    const nextOrder = sort === key && order === 'asc' ? 'desc' : 'asc';
    patch({ sort: key, order: nextOrder });
  }

  const columns = useMemo<ColumnDef<ProductRow>[]>(
    () => [
      { key: 'name', header: 'Name', sortable: true, render: (p) => p.name },
      {
        key: 'sku',
        header: 'SKU',
        sortable: true,
        render: (p) => <span className="font-mono text-xs">{p.sku}</span>,
      },
      { key: 'categoryName', header: 'Category', render: (p) => p.categoryName ?? '—' },
      { key: 'quantity', header: 'Qty', sortable: true, align: 'right', render: (p) => p.quantity },
      {
        key: 'stockStatus',
        header: 'Status',
        render: (p) => <StockStatusBadge status={p.stockStatus} isArchived={p.isArchived} />,
      },
      {
        key: 'costPrice',
        header: 'Cost / Sell',
        sortable: true,
        align: 'right',
        render: (p) =>
          `${formatMoney(p.costPrice, currency)} / ${formatMoney(p.sellingPrice, currency)}`,
      },
    ],
    [currency],
  );

  const rowActions = useCallback((): RowAction<ProductRow>[] => {
    const actions: RowAction<ProductRow>[] = [
      { label: 'View', onSelect: (p) => navigate(`/products/${p.id}`) },
    ];
    if (canManage)
      actions.push({ label: 'Edit', onSelect: (p) => navigate(`/products/${p.id}/edit`) });
    return actions;
  }, [canManage, navigate]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Products</h1>
        {canManage && <Button onClick={() => navigate('/products/new')}>Add product</Button>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-xs flex-1">
          <SearchInput
            value={search}
            onDebouncedChange={(value) => patch({ search: value, page: 1 }, true)}
            placeholder="Search name, SKU, or barcode"
            label="Search products"
          />
        </div>
        <select
          aria-label="Filter by category"
          value={categoryId}
          onChange={(e) => patch({ categoryId: e.target.value, page: 1 })}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by stock status"
          value={stockStatus}
          onChange={(e) => patch({ stockStatus: e.target.value, page: 1 })}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All stock</option>
          <option value="in">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        {canManage && (
          <label className="flex items-center gap-2 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => patch({ archived: e.target.checked ? 'true' : '', page: 1 })}
            />
            Show archived
          </label>
        )}
      </div>

      {error ? (
        <AlertBanner
          tone="danger"
          message="Couldn't load products."
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
            rowKey={(p) => p.id}
            sort={{ key: sort, dir: order }}
            onSortChange={onSortChange}
            rowActions={rowActions}
            mobileCard={(p) => <ProductRowCard product={p} />}
            loading={loading}
            emptyState={
              <EmptyState
                message={search ? 'No products match your search.' : 'No products yet.'}
                action={
                  canManage && !search ? (
                    <Button onClick={() => navigate('/products/new')}>Add the first product</Button>
                  ) : undefined
                }
              />
            }
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
    </section>
  );
}
