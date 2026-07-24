/**
 * F3 — Categories page + CategoryFormModal + ReassignDeleteModal against their
 * contracts: list render with counts, create happy path + refetch, duplicate
 * name inline echo (APR-08 VALIDATION_ERROR on `name`), the reassign-and-delete
 * flow (T5), and the system category rendering no row actions (BR-28).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/categories', () => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

import { createCategory, deleteCategory, listCategories } from '../../src/api/categories';
import { ApiError } from '../../src/api/client';
import { useAuthStore } from '../../src/stores/authStore';
import CategoriesPage from '../../src/pages/Categories';

const mockedList = vi.mocked(listCategories);
const mockedCreate = vi.mocked(createCategory);
const mockedDelete = vi.mocked(deleteCategory);

const CATEGORIES = [
  { id: 'c1', name: 'Electronics', description: 'Cables', isSystem: false, productCount: 3 },
  { id: 'c2', name: 'Uncategorized', isSystem: true, productCount: 5 },
];

function listResponse(data = CATEGORIES) {
  return { data, page: 1, limit: 20, totalItems: data.length, totalPages: 1 };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/categories']}>
      <CategoriesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue(listResponse());
  useAuthStore.getState().setSession('token', {
    id: 'admin',
    name: 'Ada Admin',
    email: 'ada@example.com',
    role: 'ADMIN',
    mustChangePassword: false,
  });
});

describe('Categories page (FR-CAT)', () => {
  it('renders category rows with product counts', async () => {
    renderPage();
    expect(await screen.findAllByText('Electronics')).not.toHaveLength(0);
    expect(screen.getAllByText('Uncategorized').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('creates a category and refetches', async () => {
    mockedCreate.mockResolvedValue({ id: 'c3', name: 'Tools', isSystem: false });
    renderPage();
    await screen.findAllByText('Electronics');

    await userEvent.click(screen.getByRole('button', { name: /add category/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'Tools');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    expect(mockedCreate).toHaveBeenCalledWith({ name: 'Tools' });
    expect(mockedList).toHaveBeenCalledTimes(2); // initial + post-save refetch
  });

  it('maps a duplicate name to an inline field error, preserving input (APR-08)', async () => {
    mockedCreate.mockRejectedValue(
      new ApiError({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        status: 400,
        details: [{ field: 'name', message: 'A category with this name already exists.' }],
      }),
    );
    renderPage();
    await screen.findAllByText('Electronics');

    await userEvent.click(screen.getByRole('button', { name: /add category/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'Electronics');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/name/i)).toHaveValue('Electronics'); // preserved
  });

  it('reassign-and-delete: passes the target category id (T5)', async () => {
    mockedDelete.mockResolvedValue(undefined);
    renderPage();
    await screen.findAllByText('Electronics');

    // Electronics is the first row (it has actions; Uncategorized has none)
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]!);
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/3 products use/i)).toBeInTheDocument();
    // default reassignment target is Uncategorized (the system category)
    expect(within(dialog).getByLabelText(/reassign products to/i)).toHaveValue('c2');

    await userEvent.click(within(dialog).getByRole('button', { name: /reassign & delete/i }));
    expect(mockedDelete).toHaveBeenCalledWith('c1', 'c2');
  });

  it('the system category renders no row actions (BR-28 undeletable/unmodifiable)', async () => {
    renderPage();
    await screen.findAllByText('Electronics');
    // DataTable renders each row twice (desktop table + mobile card, CSS-hidden).
    // Only Electronics is actionable → 2 menus; Uncategorized contributes 0.
    expect(screen.getAllByRole('button', { name: /row actions/i })).toHaveLength(2);
  });
});
