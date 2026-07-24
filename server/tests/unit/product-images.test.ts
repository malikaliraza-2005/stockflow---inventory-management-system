/**
 * F5 T-c — ProductService image behavior on a replica-set memory server:
 * host-pinned URL validation (VAL Issue 4), storage on create, and the BR-38
 * destroy-on-replace / destroy-on-hard-delete post-commit cleanup (verified via
 * an injected fake Cloudinary that records destroyed publicIds).
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/errors/AppError.js';
import type { CloudinaryClient } from '../../src/lib/cloudinary.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Category } from '../../src/models/Category.js';
import { Product } from '../../src/models/Product.js';
import { Settings } from '../../src/models/Settings.js';
import { Transaction } from '../../src/models/Transaction.js';
import { AuditService } from '../../src/services/AuditService.js';
import { MovementService } from '../../src/services/MovementService.js';
import { ProductService } from '../../src/services/ProductService.js';
import { UploadService } from '../../src/services/UploadService.js';

const HOST = 'res.cloudinary.com';
let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });
const actorId = new Types.ObjectId();
let categoryId: string;
let destroyed: string[];

function img(id: string, isPrimary = false) {
  return { publicId: `ims/prod/${id}`, url: `https://${HOST}/demo/${id}.jpg`, isPrimary };
}

function makeService(): ProductService {
  const audit = new AuditService(logger);
  destroyed = [];
  const cloudinary: CloudinaryClient = {
    cloudName: 'c',
    apiKey: 'k',
    signUpload: ({ timestamp }) => ({ signature: 's', timestamp }),
    destroy: async (publicId) => {
      destroyed.push(publicId);
      return { result: 'ok' };
    },
  };
  return new ProductService({
    audit,
    movement: new MovementService({ audit }),
    uploads: new UploadService({ cloudinary }),
    deliveryHost: HOST,
    logger,
  });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Widget',
    categoryId,
    costPrice: '10.00',
    sellingPrice: '15.00',
    initialQuantity: 0,
    ...overrides,
  } as Parameters<ProductService['create']>[0];
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([Product.init(), Category.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    Product.deleteMany({}),
    Transaction.deleteMany({}),
    Category.deleteMany({}),
    Settings.deleteMany({}),
    AuditLog.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
  ]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
  categoryId = (await Category.create({ name: 'Electronics' }))._id.toString();
});

describe('create with images', () => {
  it('stores the images', async () => {
    const service = makeService();
    const { product } = await service.create(baseInput({ images: [img('a', true)] }), actorId);
    expect(product.images).toHaveLength(1);
    expect(product.images[0]).toMatchObject({ publicId: 'ims/prod/a', isPrimary: true });
  });

  it('rejects an image URL whose host is not the configured delivery host (VAL Issue 4)', async () => {
    const service = makeService();
    const evil = { publicId: 'ims/prod/x', url: 'https://evil.example.com/x.jpg', isPrimary: true };
    await expect(service.create(baseInput({ images: [evil] }), actorId)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('destroys just-uploaded assets when the save fails (FEV-01)', async () => {
    const service = makeService();
    // force a duplicate-SKU failure after images were "uploaded"
    await service.create(baseInput({ sku: 'DUP-1' }), actorId);
    await service
      .create(baseInput({ sku: 'DUP-1', images: [img('orphan', true)] }), actorId)
      .catch(() => undefined);
    expect(destroyed).toContain('ims/prod/orphan');
  });
});

describe('destroy-on-replace / hard delete (BR-38, post-commit)', () => {
  it('PATCH replacing an image destroys the removed publicId, keeps the retained one', async () => {
    const service = makeService();
    const { product } = await service.create(
      baseInput({ images: [img('keep', true), img('drop', false)] }),
      actorId,
    );
    await service.update(
      product._id.toString(),
      { version: 0, images: [img('keep', true), img('new', false)] },
      actorId,
    );
    expect(destroyed).toEqual(['ims/prod/drop']); // only the removed one
  });

  it('hard delete destroys all of the product images', async () => {
    const service = makeService();
    const { product } = await service.create(
      baseInput({ initialQuantity: 0, images: [img('one', true), img('two', false)] }),
      actorId,
    );
    await service.hardDelete(product._id.toString(), actorId);
    expect(destroyed.sort()).toEqual(['ims/prod/one', 'ims/prod/two']);
  });
});
