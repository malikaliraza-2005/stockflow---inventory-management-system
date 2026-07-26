/**
 * DEV-ONLY database reset. Drops the entire connected database — every document
 * AND every index — so the multi-tenant schema starts from a clean slate.
 *
 * Why this exists: converting the single-org app to multi-tenant changed the
 * index set (tenant-leading / partial uniqueness) and added `tenantId`
 * everywhere. A database created under the OLD schema keeps its old global
 * unique indexes (e.g. `categories.name`), which then reject the per-tenant
 * rows a fresh signup creates. Dropping and re-seeding is the clean fix in dev,
 * where there is no production data to preserve.
 *
 * Refuses to run when NODE_ENV=production. Run with:  npm run db:reset:dev
 */
import mongoose from 'mongoose';

import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  if (env.NODE_ENV === 'production') {
    throw new Error('resetDb refuses to run with NODE_ENV=production — this DROPS all data.');
  }

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  try {
    const name = mongoose.connection.name;
    await mongoose.connection.dropDatabase();
    logger.warn({ database: name }, 'DEV database dropped — all documents and indexes removed');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
