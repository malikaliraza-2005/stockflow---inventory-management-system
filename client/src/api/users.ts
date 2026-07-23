/**
 * Typed users client — the 05 §7.2 surface (F2). Types come from the
 * generated contract (NFR-27). List params map to the server's query schema.
 */
import { api } from './client';
import type { components } from '../types/api';

export type User = components['schemas']['User'];
export type OwnProfile = components['schemas']['OwnProfile'];
export type Role = components['schemas']['Role'];
type UserCreateRequest = components['schemas']['UserCreateRequest'];
type UserUpdateRequest = components['schemas']['UserUpdateRequest'];
type ResetLinkResponse = components['schemas']['ResetLinkResponse'];

export interface UsersListParams {
  page?: number | undefined;
  limit?: number | undefined;
  role?: Role | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
  sort?: 'name' | 'email' | 'createdAt' | 'lastLoginAt' | undefined;
  order?: 'asc' | 'desc' | undefined;
}

export interface UsersListResponse {
  data: User[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export async function listUsers(params: UsersListParams): Promise<UsersListResponse> {
  const response = await api.get<UsersListResponse>('/users', { params });
  return response.data;
}

export async function createUser(body: UserCreateRequest): Promise<User> {
  const response = await api.post<User>('/users', body);
  return response.data;
}

export async function updateUser(id: string, body: UserUpdateRequest): Promise<User> {
  const response = await api.patch<User>(`/users/${id}`, body);
  return response.data;
}

export async function issueResetLink(id: string): Promise<ResetLinkResponse> {
  const response = await api.post<ResetLinkResponse>(`/users/${id}/reset-password`);
  return response.data;
}

// Own profile (Profile page)
export async function getOwnProfile(): Promise<OwnProfile> {
  const response = await api.get<OwnProfile>('/users/me');
  return response.data;
}

export async function updateOwnProfile(name: string): Promise<OwnProfile> {
  const response = await api.patch<OwnProfile>('/users/me', { name });
  return response.data;
}
