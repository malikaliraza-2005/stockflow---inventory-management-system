/**
 * Chat controller — HTTP concerns only (BEA §2).
 *
 * ── Why the message id is minted HERE ─────────────────────────────────────
 * `requestId.ts` deliberately HONORS a well-formed inbound `X-Correlation-Id`
 * so a trace can span client retries. That is right for tracing and wrong for a
 * join key: this id is what a later thumbs-up event is matched on, so a client
 * could otherwise attach its feedback to another user's message — or collide two
 * messages onto one id. So chat mints its own, server-side, unspoofable.
 *
 * The request's correlation id is still logged alongside it (`requestId`), so a
 * chat record and the HTTP completion log line remain joinable.
 */
import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { serializeChatResult } from '../serializers/chat.js';
import type { ChatService } from '../services/ChatService.js';
import type { ChatAskInput, ChatFeedbackInput } from '../validation/schemas/chat.js';

export function createChatController(chatService: ChatService) {
  const ask: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as ChatAskInput;
    const user = req.user!; // `authenticate` runs first on this route
    const messageId = randomUUID();

    const result = await chatService.ask({
      question: body.question,
      conversationId: body.conversationId,
      actor: { id: user._id.toString(), role: user.role },
      correlationId: messageId,
      requestId: req.correlationId,
      logger: req.log,
    });

    res.json(serializeChatResult(result, messageId));
  });

  /**
   * Thumbs up/down. A LOG EVENT, not a resource — thumbs are the cheapest
   * labelled data available for improving the classifier, and keyed on the
   * message's correlationId they join straight to its record. No collection, no
   * CRUD, nothing to migrate.
   */
  const feedback: RequestHandler = (req, res) => {
    const body = req.body as ChatFeedbackInput;
    req.log.info(
      {
        chatFeedback: {
          correlationId: body.correlationId,
          rating: body.rating,
          userId: req.user!._id.toString(),
        },
      },
      'chat feedback',
    );
    res.status(204).end();
  };

  return { ask, feedback };
}
