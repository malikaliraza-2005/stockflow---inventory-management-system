/**
 * Typed chat client — one POST, one JSON answer. No streaming: a single short
 * classification call finishes fast, and SSE would need a compression bypass on
 * the server plus fetch + ReadableStream here (EventSource cannot send a Bearer
 * header). Revisit if p95 ever exceeds ~3s.
 *
 * Types come from the generated contract, so the per-intent union the server
 * declares is the union this file narrows on — no hand-written row shapes.
 */
import { api } from './client';
import type { components } from '../types/api';

export type ChatResponse = components['schemas']['ChatResponse'];
export type ChatProductLookupResult = components['schemas']['ChatProductLookupResult'];
export type ChatLowStockResult = components['schemas']['ChatLowStockResult'];
export type ChatMovementHistoryResult = components['schemas']['ChatMovementHistoryResult'];
export type ChatUnsupportedResult = components['schemas']['ChatUnsupportedResult'];
export type ChatClarifyResult = components['schemas']['ChatClarifyResult'];

export type ChatRating = 'up' | 'down';

export async function askAssistant(args: {
  conversationId: string;
  question: string;
}): Promise<ChatResponse> {
  const response = await api.post<ChatResponse>('/chat', args);
  return response.data;
}

/**
 * Fire-and-forget: a failed rating must never surface as an error to someone
 * who just clicked a thumb. The signal is nice to have; the answer they are
 * reading is the thing that matters.
 */
export async function rateAnswer(correlationId: string, rating: ChatRating): Promise<void> {
  try {
    await api.post('/chat/feedback', { correlationId, rating });
  } catch {
    // intentionally swallowed — see above
  }
}
