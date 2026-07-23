/**
 * pino structured JSON logging (NFR-23, BEA §6).
 *
 * Field policy: `timestamp, level, correlationId, userId?, method, path,
 * status, durationMs, code?` — correlationId arrives via per-request child
 * loggers (middleware/requestId). SEC-12: no PII, tokens, or raw scan
 * payloads; redaction below is belt-and-braces for future call sites.
 */
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'authorization',
        '*.authorization',
        'password',
        '*.password',
        'token',
        '*.token',
        'cookie',
        '*.cookie',
      ],
      censor: '[REDACTED]',
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
