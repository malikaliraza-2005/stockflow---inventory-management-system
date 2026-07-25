/**
 * Typed movements client — the 05 §7.5 surface (F6). The one over-the-wire
 * quantity writer (Boundary T1). The `Idempotency-Key` header (BR-20) is passed
 * per call from the dialog's `useIdempotencyKey`; a retry reuses the same key so
 * the server replays the original outcome (ARB-02).
 */
import { api } from './client';
import type { components } from '../types/api';

export type MovementRequest = components['schemas']['MovementRequest'];
export type MovementResponse = components['schemas']['MovementResponse'];
export type MovementTransaction = components['schemas']['MovementTransaction'];

export async function recordMovement(
  body: MovementRequest,
  idempotencyKey: string,
): Promise<MovementResponse> {
  const response = await api.post<MovementResponse>('/inventory/movements', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data;
}
