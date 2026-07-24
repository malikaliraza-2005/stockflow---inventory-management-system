/**
 * Categories page — WIR §10 / FR-CAT (F3). Any role views; writes are Admin
 * (controls gated by usePermission — the server enforces). Composes DataTable +
 * Pagination over the withCounts list. Row actions: Edit (CategoryFormModal),
 * Delete (ReassignDeleteModal). The system category (Uncategorized) is
 * undeletable AND unmodifiable — it renders no row actions (BR-28).
 * Mutations → explicit refetch (FD-2).
 */
import { useCallback, useMemo, useState } from 'react';

import { listCategories, type Category } from '../../api/categories';
import { CategoryFormModal } from '../../components/domain/CategoryFormModal';
import { ReassignDeleteModal } from '../../components/domain/ReassignDeleteModal';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { DataTable, type ColumnDef, type RowAction } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { usePermission } from '../../hooks/usePermission';
import { useQueryState } from '../../hooks/useQueryState';
import { useToast } from '../../hooks/useToast';
import { useUrlState } from '../../hooks/useUrlState';

const SORTABLE = new Set(['name', 'createdAt']);

export default function CategoriesPage() {
  const { get, getNumber, patch } = useUrlState();
  const toast = useToast();
  const can = usePermission();
  const canManage = can('categories.manage');

  const page = getNumber('page', 1);
  const sort = get('sort', 'name');
  const order = (get('order', 'asc') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';

  const query = useCallback(
    () =>
      listCategories({
        page,
        withCounts: true,
        sort: sort as 'name' | 'createdAt',
        order,
      }),
    [page, sort, order],
  );
  const { data, loading, error, refetch } = useQueryState(query, [page, sort, order]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  function onSortChange(key: string) {
    if (!SORTABLE.has(key)) return;
    const nextOrder = sort === key && order === 'asc' ? 'desc' : 'asc';
    patch({ sort: key, order: nextOrder });
  }

  const columns = useMemo<ColumnDef<Category>[]>(
    () => [
      { key: 'name', header: 'Name', sortable: true, render: (c) => c.name },
      {
        key: 'description',
        header: 'Description',
        render: (c) => c.description ?? <span className="text-gray-400">—</span>,
      },
      {
        key: 'productCount',
        header: 'Products',
        align: 'right',
        render: (c) => c.productCount ?? 0,
      },
    ],
    [],
  );

  const rowActions = useCallback(
    (category: Category): RowAction<Category>[] => {
      // The system category is undeletable AND unmodifiable (BR-28) — no actions.
      if (!canManage || category.isSystem) return [];
      return [
        {
          label: 'Edit',
          onSelect: (c) => {
            setEditing(c);
            setFormOpen(true);
          },
        },
        { label: 'Delete', tone: 'danger', onSelect: (c) => setDeleting(c) },
      ];
    },
    [canManage],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Categories</h1>
        {canManage && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Add category
          </Button>
        )}
      </div>

      {error ? (
        <AlertBanner
          tone="danger"
          message="Couldn't load categories."
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
            rowKey={(c) => c.id}
            sort={{ key: sort, dir: order }}
            onSortChange={onSortChange}
            rowActions={rowActions}
            loading={loading}
            emptyState={
              <EmptyState
                message="No categories yet."
                action={
                  canManage ? (
                    <Button
                      onClick={() => {
                        setEditing(null);
                        setFormOpen(true);
                      }}
                    >
                      Add the first category
                    </Button>
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

      <CategoryFormModal
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          toast.success(editing ? 'Category updated.' : 'Category created.');
          refetch();
        }}
      />
      <ReassignDeleteModal
        open={deleting !== null}
        category={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          toast.success('Category deleted.');
          refetch();
        }}
      />
    </section>
  );
}
