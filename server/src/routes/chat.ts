/**
 * `/chat` router — the AI Inventory Assistant's entire HTTP surface.
 *
 * Role annotation SPREAD FROM THE GENERATED MATRIX: `chat.use` (both roles).
 * The per-intent capability check (`products.view` / `transactions.view`) is a
 * SECOND gate inside `ChatService.dispatch` — this one only says "may use the
 * assistant at all".
 *
 * The limiter is keyed on the USER, not the IP. The route is authenticated, so
 * IP keying would make an office behind one NAT share a single budget while
 * failing to isolate one abusive account — exactly backwards. It sits AFTER
 * `authenticate` because that is where `req.user` first exists.
 *
 * Note the existing limiter store is in-memory per instance, so it under-counts
 * across multiple Render instances (AAD §6). That is accepted here: this is a
 * cost guard, not a security boundary.
 */
import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createChatController } from '../controllers/chatController.js';
import { RateLimitedError } from '../errors/AppError.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { chatAskSchema, chatFeedbackSchema } from '../validation/schemas/chat.js';

export interface ChatRouterDeps {
  controller: ReturnType<typeof createChatController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
  limits: { windowMs: number; max: number };
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const { controller, authenticate, authorize, limits } = deps;
  const router = Router();

  const useChat = authorize(...rolesFor('chat.use'));
  const chatLimiter = rateLimit({
    windowMs: limits.windowMs,
    limit: limits.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?._id.toString() ?? 'anonymous',
    handler: (_req, _res, next) => {
      next(new RateLimitedError());
    },
  });

  router.post('/', authenticate, chatLimiter, useChat, validate(chatAskSchema), controller.ask);

  // Feedback is deliberately NOT limited by the LLM budget — it costs nothing,
  // and throttling it would suppress the one signal that improves the classifier.
  router.post(
    '/feedback',
    authenticate,
    useChat,
    validate(chatFeedbackSchema),
    controller.feedback,
  );

  return router;
}
