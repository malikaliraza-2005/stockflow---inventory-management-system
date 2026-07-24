/**
 * Typed products client — the 05 §7.3 surface (F4). Types from the generated
 * contract (NFR-27). Reads Any-role; writes/lifecycle Admin (server-enforced,
 * UI-gated). Images ride the create/update body (F5).
 */
import { api } from './client';
import type { components } from '../types/api';

export type Product = components['schemas']['Product'];
export type ProductRow = components['schemas']['ProductRow'];
export type ProductLookup = components['schemas']['ProductLookup'];
export type StockStatus = components['schemas']['StockStatus'];
export type ProductCreateRequest = components['schemas']['ProductCreateRequest'];
export type ProductUpdateRequest = components['schemas']['ProductUpdateRequest'];

export interface ProductsListParams {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  categoryId?: string | undefined;
  stockStatus?: 'in' | 'low' | 'out' | undefined;
  archived?: boolean | undefined;
  sort?: 'name' | 'sku' | 'quantity' | 'createdAt' | 'costPrice' | undefined;
  order?: 'asc' | 'desc' | undefined;
}

export interface ProductsListResponse {
  data: ProductRow[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export async function listProducts(params: ProductsListParams): Promise<ProductsListResponse> {
  const response = await api.get<ProductsListResponse>('/products', { params });
  return response.data;
}

export async function getProduct(id: string): Promise<Product> {
  const response = await api.get<Product>(`/products/${id}`);
  return response.data;
}

export async function lookupProduct(code: string): Promise<ProductLookup> {
  const response = await api.get<ProductLookup>('/products/lookup', { params: { code } });
  return response.data;
}

export async function createProduct(body: ProductCreateRequest): Promise<Product> {
  const response = await api.post<Product>('/products', body);
  return response.data;
}

export async function updateProduct(id: string, body: ProductUpdateRequest): Promise<Product> {
  const response = await api.patch<Product>(`/products/${id}`, body);
  return response.data;
}

export async function archiveProduct(id: string): Promise<Product> {
  const response = await api.post<Product>(`/products/${id}/archive`);
  return response.data;
}

export async function restoreProduct(id: string): Promise<Product> {
  const response = await api.post<Product>(`/products/${id}/restore`);
  return response.data;
}

export async function deleteProduct(id: string): Promise<void> {
  await api.delete(`/products/${id}`);
}
