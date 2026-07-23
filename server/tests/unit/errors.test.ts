/**
 * ERR §11 backend-unit requirements (task 0.9 slice):
 *  - every AppError subclass serializes to its exact envelope
 *  - unknown errors become the opaque INTERNAL_ERROR — internals never on the wire
 *  - statuses are catalog-locked
 *  - catalog ≡ openapi.yaml ErrorCode enum (both transcribe 05 §6.2 — no drift)
 * Translation-table tests (E11000, transient exhaustion, Cloudinary) arrive
 * with their sources per ERR §13.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import {
  AppError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../src/errors/AppError.js';
import { ERROR_CATALOG, ERROR_CODES } from '../../src/errors/catalog.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('catalog ↔ OpenAPI contract lockstep', () => {
  it('ERROR_CATALOG codes are exactly the openapi.yaml ErrorCode enum', () => {
    const doc = parse(readFileSync(join(HERE, '../../openapi.yaml'), 'utf8')) as {
      components: { schemas: { ErrorCode: { enum: string[] } } };
    };
    const contractCodes = [...doc.components.schemas.ErrorCode.enum].sort();
    const catalogCodes = [...ERROR_CODES].sort();
    expect(catalogCodes).toEqual(contractCodes);
  });

  it('locks every code to its 05 §6.2 status', () => {
    expect(ERROR_CATALOG.VALIDATION_ERROR).toBe(400);
    expect(ERROR_CATALOG.ACCOUNT_DEACTIVATED).toBe(401);
    expect(ERROR_CATALOG.INSUFFICIENT_STOCK).toBe(409);
    expect(ERROR_CATALOG.IDEMPOTENCY_CONFLICT).toBe(422);
    expect(ERROR_CATALOG.ACCOUNT_LOCKED).toBe(423);
    expect(ERROR_CATALOG.SERVICE_UNAVAILABLE).toBe(503);
  });
});

describe('AppError', () => {
  it('status is catalog-locked for every code — never constructor-chosen', () => {
    for (const code of ERROR_CODES) {
      expect(new AppError(code, 'x').status).toBe(ERROR_CATALOG[code]);
    }
  });

  it('serializes the exact §4 envelope with details', () => {
    const error = new AppError('INSUFFICIENT_STOCK', 'Only 12 units available.', {
      available: 12,
      requested: 25,
    });
    expect(error.toEnvelope('c1f4b7e2')).toEqual({
      error: {
        code: 'INSUFFICIENT_STOCK',
        message: 'Only 12 units available.',
        details: { available: 12, requested: 25 },
        correlationId: 'c1f4b7e2',
      },
    });
  });

  it('omits details entirely when unset — never null (05 §2 posture)', () => {
    const envelope = new NotFoundError().toEnvelope('cid');
    expect(envelope).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found.', correlationId: 'cid' },
    });
    expect('details' in envelope.error).toBe(false);
  });

  it('subclasses: NotFound → 404 · ServiceUnavailable → 503 + retryAfter · Internal → 500', () => {
    expect(new NotFoundError().status).toBe(404);
    const unavailable = new ServiceUnavailableError(15);
    expect(unavailable.status).toBe(503);
    expect(unavailable.retryAfterSeconds).toBe(15);
    expect(new InternalError().status).toBe(500);
  });
});

/** Minimal express doubles — the real app arrives with task 0.10. */
function makeRes(locals: Record<string, unknown> = {}) {
  const res = {
    locals,
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const req = {} as Request;
const next = vi.fn();

describe('terminal errorHandler (the only failure-response writer)', () => {
  it('serializes a known AppError with its locked status + correlation ID', () => {
    const res = makeRes({ correlationId: 'abc-123' });
    createErrorHandler(vi.fn())(new NotFoundError(), req, res as unknown as Response, next);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found.', correlationId: 'abc-123' },
    });
  });

  it('unknown error → opaque INTERNAL_ERROR; internals logged, never on the wire', () => {
    const log = vi.fn();
    const res = makeRes({ correlationId: 'abc-123' });
    const leaky = new Error('db password is hunter2 at /srv/app/db.ts:42');

    createErrorHandler(log)(leaky, req, res as unknown as Response, next);

    expect(res.statusCode).toBe(500);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2'); // SEC-12
    expect(JSON.stringify(res.body)).not.toContain('db.ts');
    expect(log).toHaveBeenCalledWith(
      'unhandled error reached terminal handler',
      expect.objectContaining({ correlationId: 'abc-123', err: leaky }),
    );
  });

  it('sets Retry-After on SERVICE_UNAVAILABLE (NFR-20)', () => {
    const res = makeRes();
    createErrorHandler(vi.fn())(
      new ServiceUnavailableError(30),
      req,
      res as unknown as Response,
      next,
    );
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
  });

  it("falls back to 'unknown' correlation ID before the 0.10 middleware exists", () => {
    const res = makeRes();
    createErrorHandler(vi.fn())(new NotFoundError(), req, res as unknown as Response, next);
    expect((res.body as { error: { correlationId: string } }).error.correlationId).toBe('unknown');
  });

  it('delegates when headers were already sent (Express contract)', () => {
    const delegate = vi.fn();
    const res = makeRes();
    res.headersSent = true;
    const error = new NotFoundError();
    createErrorHandler(vi.fn())(error, req, res as unknown as Response, delegate);
    expect(delegate).toHaveBeenCalledWith(error);
    expect(res.statusCode).toBe(0); // nothing written
  });
});
