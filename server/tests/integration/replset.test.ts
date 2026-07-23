/**
 * CI substrate proof (Phase 0, task 0.3) — TST §2 requires the integration tier to run
 * on ephemeral MongoDB in REPLICA-SET mode so transactions T1–T6 are tested real.
 * This suite proves that substrate works on the CI runner before any feature depends
 * on it: replica set boots, Mongoose connects, multi-document transactions commit
 * atomically and roll back completely.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

describe('integration tier substrate: ephemeral MongoDB, replica-set mode (TST §2)', () => {
  it('commits a multi-document transaction atomically', async () => {
    const a = mongoose.connection.collection('ci_probe_a');
    const b = mongoose.connection.collection('ci_probe_b');

    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await a.insertOne({ probe: 1 }, { session });
      await b.insertOne({ probe: 1 }, { session });
    });
    await session.endSession();

    expect(await a.countDocuments()).toBe(1);
    expect(await b.countDocuments()).toBe(1);
  });

  it('rolls back completely when a transaction aborts', async () => {
    const c = mongoose.connection.collection('ci_probe_c');

    const session = await mongoose.startSession();
    session.startTransaction();
    await c.insertOne({ probe: 1 }, { session });
    await session.abortTransaction();
    await session.endSession();

    expect(await c.countDocuments()).toBe(0);
  });
});
