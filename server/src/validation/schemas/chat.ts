/**
 * Chat endpoint schemas — VAL §2 (parse before the controller, strip unknowns).
 *
 * `max(500)` on the question is a COST control, not a cosmetic bound (RISK-5):
 * without it a pasted 50 KB block becomes a 50 KB prompt, and token cost,
 * latency and free-tier quota all scale with input you never meant to accept.
 * `min(2)` matches the intent schema's own floor — a one-character question
 * cannot classify into anything useful.
 */
import { z } from 'zod';

import { uuid } from '../primitives.js';

export const chatMessages = {
  question: 'Ask a question (2–500 characters)',
  conversationId: 'Invalid conversation reference',
  rating: 'Invalid rating',
} as const;

export const chatAskSchema = z.object({
  /** Client-generated per chat session. Log field only — no memory, no
   *  Conversation collection. It is what makes question SEQUENCES recoverable. */
  conversationId: uuid,
  question: z
    .string(chatMessages.question)
    .trim()
    .min(2, chatMessages.question)
    .max(500, chatMessages.question),
});

/**
 * Thumbs up/down. Keyed on the correlationId returned in the answer body, which
 * joins it straight to that message's log record — no CRUD, no collection, and
 * no fragile client-side message index (a retry or failed send shifts every
 * later index).
 */
export const chatFeedbackSchema = z.object({
  correlationId: z.string().trim().min(1).max(128),
  rating: z.enum(['up', 'down'], { message: chatMessages.rating }),
});

export type ChatAskInput = z.infer<typeof chatAskSchema>;
export type ChatFeedbackInput = z.infer<typeof chatFeedbackSchema>;
