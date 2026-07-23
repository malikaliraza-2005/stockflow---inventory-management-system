/**
 * Release-phase entrypoint (DEP §11): `npm run seed` — runs before new
 * instances start, in every environment. Exit 0 = seeded + integrity green;
 * exit 1 = the deploy must not proceed.
 */
import mongoose from 'mongoose';

import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { verifyBootIntegrity } from './integrity.js';
import { runSeed } from './index.js';

async function main(): Promise<void> {
  const env = loadEnv(); // fail-fast, named variable (NFR-28)
  const logger = createLogger(env.LOG_LEVEL);

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  try {
    await runSeed(env, logger);
    await verifyBootIntegrity();
    logger.info('seed release phase green — integrity verified');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
