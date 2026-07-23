/**
 * F2 — DataTable core (UCA §3.1): every specified state renders — loading
 * skeleton, empty state, sortable header aria-sort + toggle, row-action menu,
 * mobileCard fallback.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type ColumnDef } from '../../src/components/ui/DataTable';

interface Row {
  id: string;
  name: string;
}
const columns: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (r) => r.name },
  { key: 'id', header: 'ID', render: (r) => r.id },
];
const rows: Row[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

describe('DataTable states (UCA §3.1)', () => {
  it('renders skeleton rows while loading', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        loading
        emptyState={<p>empty</p>}
      />,
    );
    expect(screen.getByTestId('datatable-loading')).toBeInTheDocument();
  });

  it('renders the empty state when there are no rows', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyState={<p>no rows here</p>}
      />,
    );
    expect(screen.getByText('no rows here')).toBeInTheDocument();
  });

  it('renders rows and reflects sort direction via aria-sort', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', dir: 'asc' }}
        onSortChange={vi.fn()}
        emptyState={<p>empty</p>}
      />,
    );
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    const nameHeader = screen
      .getAllByRole('columnheader')
      .find((h) => within(h).queryByText('Name'));
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('emits the sorted key when a sortable header is clicked', async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onSortChange={onSortChange}
        emptyState={<p>empty</p>}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSortChange).toHaveBeenCalledWith('name');
  });

  it('opens the row-action menu and fires the selected action', async () => {
    const onSelect = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowActions={() => [{ label: 'Edit', onSelect }]}
        emptyState={<p>empty</p>}
      />,
    );
    // desktop table + mobile stack both render an action button; use the first
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]!);
    await userEvent.click(screen.getAllByRole('menuitem', { name: 'Edit' })[0]!);
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
  });
});
