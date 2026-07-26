/**
 * AuditTrailTab — WIR §11 Audit tab (F7 P5 slice, Admin-only). Browsable audit
 * trail: entity/date filters, `entityLabel` rendering (DN-4 — survives hard
 * deletes), security events, and DataTable ROW EXPANSION for before/after diffs
 * (expansion's first consumer). Filters live in the URL (SMP §4).
 *
 * The API (05 §7.6) filters by entity type / entity / actor / date — there is no
 * server `action` filter, so this tab exposes entity + date (actor is API-ready
 * for a future picker). Expansion is accessible: each toggle carries
 * aria-expanded (DataTable), and diffs render as a field → before → after list.
 */
import { useCallback, useMemo } from 'react';

import { listAuditLogs, type AuditEntityType, type AuditLogRow } from '../../api/audit';
import { DataTable, type ColumnDef } from '../../components/ui/DataTable';
import { AlertBanner } from '../ui/AlertBanner';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Pagination } from '../ui/Pagination';
import { useQueryState } from '../../hooks/useQueryState';
import { useUrlState } from '../../hooks/useUrlState';
import { formatDateTime } from '../../lib/formatters';

const ENTITY_TYPES: AuditEntityType[] = ['PRODUCT', 'CATEGORY', 'USER', 'SETTINGS', 'SECURITY'];

/** Render an audit diff value (money strings, booleans, absent) for display. */
function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AuditTrailTab() {
  const { get, getNumber, patch } = useUrlState();

  const page = getNumber('page', 1);
  const from = get('from');
  const to = get('to');
  const entityParam = get('entityType');
  const entityType = (ENTITY_TYPES as readonly string[]).includes(entityParam)
    ? (entityParam as AuditEntityType)
    : undefined;

  const query = useCallback(
    () =>
      listAuditLogs({
        page,
        entityType,
        from: from || undefined,
        to: to || undefined,
      }),
    [page, entityType, from, to],
  );
  const { data, loading, error, refetch } = useQueryState(query, [page, entityType, from, to]);

  const columns = useMemo<ColumnDef<AuditLogRow>[]>(
    () => [
      {
        key: 'createdAt',
        header: 'Time',
        render: (row) => (
          <span className="whitespace-nowrap text-sm text-gray-600">
            {formatDateTime(row.createdAt)}
          </span>
        ),
      },
      { key: 'actorName', header: 'Actor', render: (row) => row.actorName },
      {
        key: 'action',
        header: 'Action',
        render: (row) => <Badge tone="neutral">{row.action}</Badge>,
      },
      {
        key: 'entity',
        header: 'Entity',
        render: (row) => (
          <span className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{row.entityLabel}</span>
            <span className="text-xs text-gray-500">{row.entityType}</span>
          </span>
        ),
      },
      {
        key: 'changes',
        header: 'Changes',
        render: (row) =>
          row.changes && row.changes.length > 0 ? (
            <span className="text-sm text-gray-600">{row.changes.length} field(s)</span>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
    ],
    [],
  );

  const renderExpandedRow = (row: AuditLogRow) => {
    if (!row.changes || row.changes.length === 0) {
      return (
        <p className="text-sm text-gray-500">
          No field changes{row.ip ? ` · from ${row.ip}` : ''}.
        </p>
      );
    }
    return (
      <dl className="space-y-1">
        {row.changes.map((change) => (
          <div key={change.field} className="flex flex-wrap items-baseline gap-2 text-sm">
            <dt className="font-medium text-gray-700">{change.field}:</dt>
            <dd className="text-gray-500 line-through">{displayValue(change.before)}</dd>
            <span aria-hidden="true" className="text-gray-400">
              →
            </span>
            <dd className="text-gray-900">{displayValue(change.after)}</dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Entity</span>
          <select
            value={entityType ?? ''}
            onChange={(e) => patch({ entityType: e.target.value || undefined }, true)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All entities</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => patch({ from: e.target.value }, true)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => patch({ to: e.target.value }, true)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {error ? (
        <AlertBanner
          tone="danger"
          message="Couldn't load the audit trail."
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
            renderExpandedRow={renderExpandedRow}
            emptyState={<EmptyState message="No audit entries match these filters." />}
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
