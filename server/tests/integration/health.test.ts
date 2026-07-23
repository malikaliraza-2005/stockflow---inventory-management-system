/**
 * Task 0.10 — observability spine, contract-locked to server/openapi.yaml:
 * /health + /ready shapes, 503 + Retry-After when not ready, correlation-ID
 * echo/generation on every non-health response, unknown-route 404 envelope
 * (ERR §11), and the BEA §6 completion-log field set.
 *
 * No database: the app factory takes an injected readiness provider — DB-backed
 * readiness truth lives in server.ts and is exercised on staging (task 0.12).
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';

interface LogLine {
  msg: string;
  correlationId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
}

function makeApp(ready: boolean) {
  const lines: LogLine[] = [];
  const logger = createLogger('info', {
    write(chunk: string) {
      lines.push(JSON.parse(chunk) as LogLine);
    },
  });
  const app = createApp({ logger, isReady: () => ready });
  return { app, lines };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('GET /health (liveness — NFR-14)', () => {
  it('returns the exact contract body', async () => {
    const { app } = makeApp(false); // liveness is readiness-independent
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /ready (readiness — NFR-15)', () => {
  it('returns the contract body when ready', async () => {
    const { app } = makeApp(true);
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('returns 503 + Retry-After + SERVICE_UNAVAILABLE envelope when not ready', async () => {
    const { app } = makeApp(false);
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service not ready.',
        correlationId: 'unknown', // health mounts ahead of requestId — by design
      },
    });
  });
});

describe('correlation IDs (NFR-23, 05 §1)', () => {
  it('generates a UUID and carries it in header AND envelope', async () => {
    const { app } = makeApp(true);
    const res = await request(app).get('/no-such-route');
    const header = res.headers['x-correlation-id'];
    expect(header).toMatch(UUID_PATTERN);
    expect((res.body as { error: { correlationId: string } }).error.correlationId).toBe(header);
  });

  it('honors a well-formed inbound X-Correlation-Id across the response', async () => {
    const { app } = makeApp(true);
    const res = await request(app).get('/no-such-route').set('X-Correlation-Id', 'trace-abc-123');
    expect(res.headers['x-correlation-id']).toBe('trace-abc-123');
    expect((res.body as { error: { correlationId: string } }).error.correlationId).toBe(
      'trace-abc-123',
    );
  });

  it('rejects a malformed inbound ID and generates its own (log-injection guard)', async () => {
    const { app } = makeApp(true);
    const res = await request(app)
      .get('/no-such-route')
      .set('X-Correlation-Id', 'bad id with spaces');
    expect(res.headers['x-correlation-id']).toMatch(UUID_PATTERN);
  });
});

describe('unknown route (ERR §11)', () => {
  it('returns the 404 NOT_FOUND envelope', async () => {
    const { app } = makeApp(true);
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Resource not found.');
  });
});

describe('completion logging (BEA §6 field set)', () => {
  it('logs method, path, status, durationMs on the correlation child', async () => {
    const { app, lines } = makeApp(true);
    await request(app).get('/no-such-route').set('X-Correlation-Id', 'trace-log-1');

    const entry = lines.find((line) => line.msg === 'request completed');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      correlationId: 'trace-log-1',
      method: 'GET',
      path: '/no-such-route',
      status: 404,
    });
    expect(typeof entry?.durationMs).toBe('number');
  });

  it('does not log health-endpoint traffic (mounted ahead of the loggers)', async () => {
    const { app, lines } = makeApp(true);
    await request(app).get('/health');
    expect(lines.find((line) => line.path === '/health')).toBeUndefined();
  });
});
