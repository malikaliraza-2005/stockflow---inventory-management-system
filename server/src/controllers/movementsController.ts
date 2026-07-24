/**
 * Movements controller — HTTP concerns only (BEA §2): validated body + the
 * Idempotency-Key header → MovementService.recordMovement → serializer.
 *
 * The `Idempotency-Key` header (BR-20, 05 §4) is validated HERE, not in the body
 * schema: it is required and must be an RFC-4122 UUID (any version, APR-07);
 * missing or malformed → 400 VALIDATION_ERROR. A successful movement — fresh OR
 * replayed — returns 200 with the same body shape (A-4).
 */
import type { RequestHandler } from 'express';

import { ValidationError } from '../errors/AppError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { serializeMovement } from '../serializers/movement.js';
import type { MovementService } from '../services/MovementService.js';
import { uuid } from '../validation/primitives.js';
import type { MovementInput } from '../validation/schemas/movements.js';

export function createMovementsController(movementService: MovementService) {
  const create: RequestHandler = asyncHandler(async (req, res) => {
    const key = uuid.safeParse(req.header('Idempotency-Key'));
    if (!key.success) {
      throw new ValidationError([
        { field: 'Idempotency-Key', message: 'A valid Idempotency-Key header (UUID) is required.' },
      ]);
    }
    const result = await movementService.recordMovement({
      idempotencyKey: key.data,
      input: req.body as MovementInput,
      actorId: req.user!._id,
      ctx: { ip: req.ip },
    });
    res.json(serializeMovement(result));
  });

  return { create };
}
