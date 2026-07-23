/**
 * DataTable<T> — UCA §3.1: THE one table implementation (F2 is its first
 * consumer — RDM Issue 1). Stateless: sort/pagination/filters live in the
 * page's URL params, never inside the table (SMA §2).
 *
 * F2 slice: columns, sortable headers with aria-sort, row actions, loading
 * skeleton rows, empty state, mobileCard renderer (< 768). Expansion
 * (renderExpandedRow) lands with F7 (Audit Trail — its first consumer); the
 * prop surface is declared so later features extend, never re-cut.
 */
import { useState, type ReactNode } from 'react';

import { Skeleton } from './Skeleton';

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
}

export interface RowAction<T> {
  label: string;
  onSelect: (row: T) => void;
  tone?: 'default' | 'danger';
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: { key: string; dir: 'asc' | 'desc' } | undefined;
  onSortChange?: ((key: string) => void) | undefined;
  rowActions?: ((row: T) => RowAction<T>[]) | undefined;
  mobileCard?: ((row: T) => ReactNode) | undefined;
  emptyState: ReactNode;
  loading?: boolean;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  rowActions,
  mobileCard,
  emptyState,
  loading = false,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="space-y-2" data-testid="datatable-loading">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} variant="table-row" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div data-testid="datatable-empty">{emptyState}</div>;
  }

  return (
    <>
      {/* ≥ 768: real table */}
      <table className="hidden w-full border-collapse text-sm md:table">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-600">
            {columns.map((col) => {
              const isSorted = sort?.key === col.key;
              const ariaSort = isSorted
                ? sort.dir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none';
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={col.sortable ? ariaSort : undefined}
                  className={`px-3 py-2 font-medium ${alignClass[col.align ?? 'left']}`}
                >
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(col.key)}
                      className="inline-flex items-center gap-1 hover:text-gray-900"
                    >
                      {col.header}
                      <span aria-hidden="true">
                        {isSorted ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
            {rowActions && <th scope="col" className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-gray-100 hover:bg-gray-50">
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-2 ${alignClass[col.align ?? 'left']}`}>
                  {col.render(row)}
                </td>
              ))}
              {rowActions && (
                <td className="px-3 py-2 text-right">
                  <RowActionMenu actions={rowActions(row)} row={row} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* < 768: card stack (mobileCard) or a plain key/value fallback */}
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div key={rowKey(row)} className="rounded-lg border border-gray-200 bg-white p-4">
            {mobileCard ? (
              mobileCard(row)
            ) : (
              <dl className="space-y-1">
                {columns.map((col) => (
                  <div key={col.key} className="flex justify-between gap-2 text-sm">
                    <dt className="text-gray-500">{col.header}</dt>
                    <dd className="text-gray-900">{col.render(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {rowActions && (
              <div className="mt-3 border-t border-gray-100 pt-2">
                <RowActionMenu actions={rowActions(row)} row={row} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function RowActionMenu<T>({ actions, row }: { actions: RowAction<T>[]; row: T }) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Row actions"
        onClick={() => setOpen((v) => !v)}
        className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onSelect(row);
              }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                action.tone === 'danger' ? 'text-danger-600' : 'text-gray-700'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
