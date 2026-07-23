/**
 * Pipeline #11 — `validate(schema)` (BEA §3, SRS §12.4): zod parse BEFORE the
 * controller runs; failure → 400 VALIDATION_ERROR with `details[]` in the
 * VAL §9 field format. The parsed (normalized, stripped) value REPLACES the
 * raw body — controllers only ever see typed input.
 */
import type { RequestHandler } from 'express';
import type { z } from 'zod';

import { ValidationError, type FieldIssue } from '../errors/AppError.js';

export function validate(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details: FieldIssue[] = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      }));
      next(new ValidationError(details));
      return;
    }
    req.body = result.data;
    next();
  };
}
