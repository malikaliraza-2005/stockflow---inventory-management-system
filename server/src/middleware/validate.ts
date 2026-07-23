/**
 * Pipeline #11 — `validate(schema)` (BEA §3, SRS §12.4): zod parse BEFORE the
 * controller runs; failure → 400 VALIDATION_ERROR with `details[]` in the
 * VAL §9 field format. The parsed (normalized, stripped, type-coerced) value
 * REPLACES the raw input — controllers only ever see typed input. Boundary
 * type-coercion (string query params → numbers/booleans) happens here and
 * only here (VAL §2).
 */
import type { RequestHandler } from 'express';
import type { z } from 'zod';

import { ValidationError, type FieldIssue } from '../errors/AppError.js';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export function validate(schema: z.ZodType, target: 'body' | 'query' = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const details: FieldIssue[] = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || `(${target})`,
        message: issue.message,
      }));
      next(new ValidationError(details));
      return;
    }
    req[target] = result.data as never;
    next();
  };
}

/**
 * Universal preamble (VAL §5): every `:id` param is a 24-hex ObjectId —
 * malformed ids are a 400, never a 404 (a 404 would imply "well-formed but
 * absent", leaking shape information).
 */
export function validateObjectId(param: string): RequestHandler {
  return (req, _res, next) => {
    const value = req.params[param];
    if (!value || !OBJECT_ID_PATTERN.test(value)) {
      next(new ValidationError([{ field: param, message: 'Invalid reference' }]));
      return;
    }
    next();
  };
}
