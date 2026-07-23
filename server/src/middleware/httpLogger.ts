/**
 * Request-completion logging — pipeline position after requestId (BEA §3).
 * Emits exactly the BEA §6 field set: method, path, status, durationMs — on
 * the correlation child logger, so correlationId is always present.
 */
import type { RequestHandler } from 'express';

export function httpLogger(): RequestHandler {
  return (req, res, next) => {
    const startNs = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
      req.log.info(
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs,
        },
        'request completed',
      );
    });
    next();
  };
}
