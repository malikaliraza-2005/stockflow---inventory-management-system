/**
 * Users page — UC-04 (F2, Admin). Composes DataTable + SearchInput +
 * Pagination over the /users list; filters/search/sort/page live in the URL
 * (SMP §4). Row actions: Edit (UserFormModal), Reset password (ResetLinkModal,
 * AS-6). Mutations → explicit refetch (FD-2).
 */
import { useCallback, useMemo, useState } from 'react';

import { issueResetLink, listUsers, type User } from '../../api/users';
import { UserFormModal } from '../../components/domain/UserFormModal';
import { ResetLinkModal } from '../../components/domain/ResetLinkModal';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type ColumnDef, type RowAction } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { SearchInput } from '../../components/ui/SearchInput';
import { useQueryState } from '../../hooks/useQueryState';
import { useToast } from '../../hooks/useToast';
import { useUrlState } from '../../hooks/useUrlState';
import { formatDate, formatDateTime } from '../../lib/formatters';
import type { components } from '../../types/api';

type ResetLinkResponse = components['schemas']['ResetLinkResponse'];
const SORTABLE = new Set(['name', 'email', 'createdAt', 'lastLoginAt']);

export default function UsersPage() {
  const { get, getNumber, patch } = useUrlState();
  const toast = useToast();

  const page = getNumber('page', 1);
  const search = get('search');
  const sort = get('sort', 'createdAt');
  const order = (get('order', 'desc') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';

  const query = useCallback(
    () =>
      listUsers({
        page,
        search: search || undefined,
        sort: sort as 'name' | 'email' | 'createdAt' | 'lastLoginAt',
        order,
      }),
    [page, search, sort, order],
  );
  const { data, loading, error, refetch } = useQueryState(query, [page, search, sort, order]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetResult, setResetResult] = useState<ResetLinkResponse | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  function onSortChange(key: string) {
    if (!SORTABLE.has(key)) return;
    const nextOrder = sort === key && order === 'asc' ? 'desc' : 'asc';
    patch({ sort: key, order: nextOrder });
  }

  async function handleReset(user: User) {
    try {
      const result = await issueResetLink(user.id);
      setResetTarget(user);
      setResetResult(result);
    } catch {
      toast.error('Could not generate a reset link. Please try again.');
    }
  }

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      { key: 'name', header: 'Name', sortable: true, render: (u) => u.name },
      { key: 'email', header: 'Email', sortable: true, render: (u) => u.email },
      {
        key: 'role',
        header: 'Role',
        render: (u) => <Badge tone={u.role === 'ADMIN' ? 'success' : 'neutral'}>{u.role}</Badge>,
      },
      {
        key: 'isActive',
        header: 'Status',
        render: (u) =>
          u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>,
      },
      {
        key: 'lastLoginAt',
        header: 'Last login',
        sortable: true,
        render: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'),
      },
      {
        key: 'createdAt',
        header: 'Created',
        sortable: true,
        render: (u) => formatDate(u.createdAt),
      },
    ],
    [],
  );

  const rowActions = useCallback(
    (): RowAction<User>[] => [
      {
        label: 'Edit',
        onSelect: (u) => {
          setEditing(u);
          setFormOpen(true);
        },
      },
      { label: 'Reset password', onSelect: (u) => void handleReset(u) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Users</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Add user
        </Button>
      </div>

      <div className="max-w-sm">
        <SearchInput
          value={search}
          onDebouncedChange={(value) => patch({ search: value }, true)}
          placeholder="Search name or email"
          label="Search users"
        />
      </div>

      {error ? (
        <AlertBanner
          tone="danger"
          message="Couldn't load users."
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
            rowKey={(u) => u.id}
            sort={{ key: sort, dir: order }}
            onSortChange={onSortChange}
            rowActions={rowActions}
            loading={loading}
            emptyState={
              <EmptyState
                message={search ? 'No users match your search.' : 'No users yet.'}
                action={
                  !search ? (
                    <Button
                      onClick={() => {
                        setEditing(null);
                        setFormOpen(true);
                      }}
                    >
                      Add the first user
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

      <UserFormModal
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          toast.success(editing ? 'User updated.' : 'User created.');
          refetch();
        }}
      />
      <ResetLinkModal
        open={resetResult !== null}
        result={resetResult}
        targetName={resetTarget?.name ?? ''}
        onClose={() => setResetResult(null)}
      />
    </section>
  );
}
