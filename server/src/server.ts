/**
 * Process lifecycle — BEA §8 / DEP §5, implemented 1:1.
 *
 * boot:  validate config (fail fast, named variable, NFR-28)
 *        → listen (health endpoints must answer while booting — DEP §5's
 *          "/ready false meanwhile" presumes a live listener)
 *        → connect Mongo with retry/backoff (EC-27: misconfiguration ≠ outage)
 *        → integrity check → /ready true
 * stop:  SIGTERM → /ready false → stop accepting → drain in-flight
 *        → close DB → exit 0 (NFR-15/21)
 * crash: unhandledRejection/uncaughtException → log + track → exit
 *        (host restarts; error tracking wiring lands with the SENTRY_DSN
 *        consumer in Phase 6 hardening)
 */
import mongoose from 'mongoose';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { IntegrityError, verifyBootIntegrity } from './seeds/integrity.js';

const CONNECT_RETRY_BASE_MS = 1_000;
const CONNECT_RETRY_MAX_MS = 30_000;
const SHUTDOWN_GRACE_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function start(): Promise<void> {
  const env = loadEnv(); // throws EnvValidationError naming every bad variable
  const logger = createLogger(env.LOG_LEVEL);

  let ready = false;
  const app = createApp({
    logger,
    isReady: () => ready && mongoose.connection.readyState === 1,
    trustProxyHops: env.TRUST_PROXY_HOPS,
  });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'listening — /ready false until boot completes');
  });

  // Mongo connect with retry/backoff; /ready reports false meanwhile (EC-27).
  let attempt = 0;
  let shuttingDown = false;
  for (;;) {
    try {
      await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
      break;
    } catch (error) {
      if (shuttingDown) return;
      attempt += 1;
      const delayMs = Math.min(CONNECT_RETRY_BASE_MS * 2 ** attempt, CONNECT_RETRY_MAX_MS);
      logger.warn(
        { attempt, delayMs, err: error instanceof Error ? error.message : String(error) },
        'mongo connect failed — retrying with backoff',
      );
      await sleep(delayMs);
    }
  }

  // Integrity failure ≠ crash (DBD §8): the process stays up with /ready false
  // and logs the remediation — the seed release phase (DEP §11) is the fix.
  try {
    await verifyBootIntegrity();
  } catch (error) {
    if (error instanceof IntegrityError) {
      logger.error({ err: error.message }, 'integrity check failed — staying NOT ready');
      return; // listener stays up; /ready reports 503 until seeded + restarted
    }
    throw error;
  }
  ready = true;
  logger.info('boot complete — /ready true');

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false; // /ready flips first so the LB drains us (NFR-15)
    logger.info({ signal }, 'shutdown — draining in-flight requests');

    const force = setTimeout(() => {
      logger.error('drain grace period exceeded — forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();

    server.close(() => {
      void mongoose
        .disconnect()
        .catch(() => undefined)
        .then(() => {
          logger.info('shutdown complete');
          process.exit(0);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ERR §3 async safety: crashed invariants never limp along.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection — exiting');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception — exiting');
    process.exit(1);
  });
}
