/**
 * Entrypoint — boots the BEA §8 lifecycle. Config failures print their
 * named-variable report and abort (NFR-28); everything after that logs
 * through pino.
 */
import { start } from './server.js';

start().catch((error: unknown) => {
  // Pre-logger failures (config validation) go to stderr verbatim — the
  // named-variable message IS the operator interface here.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
