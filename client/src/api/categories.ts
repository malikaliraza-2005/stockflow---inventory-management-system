/**
 * Typed categories client — the 05 §7.4 surface (F3). Types come from the
 * generated contract (NFR-27). Reads are Any-role; writes are Admin (the server
 * enforces; the UI gates the controls via usePermission).
 */
import { api } from './client';
import type { components } from '../types/api';

export type Category = components['schemas']['Category'];
type CategoryWriteRequest = components['schemas']['CategoryWriteRequest'];

export interface CategoriesListParams {
  page?: number | undefined;
  limit?: number | undefined;
  withCounts?: boolean | undefined;
  sort?: 'name' | 'createdAt' | undefined;
  order?: 'asc' | 'desc' | undefined;
}

export interface CategoriesListResponse {
  data: Category[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export async function listCategories(
  params: CategoriesListParams = {},
): Promise<CategoriesListResponse> {
  const response = await api.get<CategoriesListResponse>('/categories', { params });
  return response.data;
}

export async function createCategory(body: CategoryWriteRequest): Promise<Category> {
  const response = await api.post<Category>('/categories', body);
  return response.data;
}

export async function updateCategory(id: string, body: CategoryWriteRequest): Promise<Category> {
  const response = await api.patch<Category>(`/categories/${id}`, body);
  return response.data;
}

/** DELETE /categories/:id — `reassignTo` is required by the server only when
 *  the category still has products (BR-27); the UI supplies it from the modal. */
export async function deleteCategory(id: string, reassignTo?: string): Promise<void> {
  await api.delete(`/categories/${id}`, {
    params: reassignTo ? { reassignTo } : undefined,
  });
}
