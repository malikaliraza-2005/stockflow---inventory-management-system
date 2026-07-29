/**
 * Chat wire serialization — the discriminated union plus the correlation id.
 *
 * The result object is already wire-shaped (its rows ARE the `/products` and
 * `/transactions` serializer outputs), so this is a one-line envelope rather
 * than a mapping layer. It exists as its own module for one reason: the
 * correlation id belongs in the BODY, not only the header, because that is the
 * key a thumbs-up event joins on.
 */
import type { ChatResult } from '../services/chat/types.js';

export type ChatPayload = ChatResult & { correlationId: string };

export function serializeChatResult(result: ChatResult, correlationId: string): ChatPayload {
  return { ...result, correlationId };
}
