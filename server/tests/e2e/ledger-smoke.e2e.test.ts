/**
 * F6/F7 E2E — the M3 "The Ledger" smoke narrative through the REAL app on a
 * replica-set memory server (phase-3-inventory-core.md DoD: "login → add product
 * → stock in → stock out → ledger-sum check"). The hard-gate assertion is the
 * last one: the product's materialized quantity equals the sum of its ledger,
 * observed over the wire (BR-17, DN-1).
 */
import { randomUUID } from 'node:crypto';

import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { Category } from '../../src/models/Category.js';
import { Settings } from '../../src/models/Settings.js';
import { Transaction } from '../../src/models/Transaction.js';
import { User } from '../../src/models/User.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const ADMIN_PW = 'admin-secret-pw-1';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });
const app = () => createApp({ logger, isReady: () => true, env: makeTestEnv() });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([Transaction.init(), Category.init()]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
  await Category.create({ name: 'Electronics' });
  await User.create({
    name: 'Administrator',
    email: 'admin@example.com',
    passwordHash: bcrypt.hashSync(ADMIN_PW, 4),
    role: 'ADMIN',
    mustChangePassword: false,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

describe('M3 The Ledger — stock movement smoke', () => {
  it('login → add product → stock in → stock out → ledger sums to quantity', async () => {
    const server = app();

    // 1. Admin signs in
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: ADMIN_PW });
    expect(login.status).toBe(200);
    const bearer = `Bearer ${login.body.accessToken}`;

    const category = await Category.findOne({ name: 'Electronics' });

    // 2. Add a product opening at 40 (INITIAL ledger row)
    const created = await request(server)
      .post('/api/v1/products')
      .set('Authorization', bearer)
      .send({
        name: 'USB-C Cable',
        categoryId: category!._id.toString(),
        costPrice: '2.10',
        sellingPrice: '5.99',
        initialQuantity: 40,
      });
    expect(created.status).toBe(201);
    const productId = created.body.id as string;
    expect(created.body.quantity).toBe(40);

    // 3. Stock in 60 → 100
    const stockIn = await request(server)
      .post('/api/v1/inventory/movements')
      .set('Authorization', bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'STOCK_IN', productId, quantity: 60 });
    expect(stockIn.status).toBe(200);
    expect(stockIn.body.product.quantity).toBe(100);

    // 4. Stock out 25 → 75
    const stockOut = await request(server)
      .post('/api/v1/inventory/movements')
      .set('Authorization', bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'STOCK_OUT', productId, quantity: 25, note: 'Order #1042' });
    expect(stockOut.status).toBe(200);
    expect(stockOut.body.product.quantity).toBe(75);

    // 5. The ledger explains the quantity: it lists INITIAL + STOCK_IN + STOCK_OUT
    const ledger = await request(server)
      .get(`/api/v1/transactions?productId=${productId}`)
      .set('Authorization', bearer);
    expect(ledger.status).toBe(200);
    expect(ledger.body.totalItems).toBe(3);

    // 6. HARD GATE — materialized quantity == Σ ledger, verified from the DB
    const product = await mongoose.connection
      .collection('products')
      .findOne({ _id: new mongoose.Types.ObjectId(productId) });
    const rows = await Transaction.aggregate<{ sum: number }>([
      { $match: { productId: new mongoose.Types.ObjectId(productId) } },
      { $group: { _id: null, sum: { $sum: '$quantityChange' } } },
    ]);
    expect(rows[0]?.sum).toBe(75);
    expect(product?.quantity).toBe(rows[0]?.sum); // BR-17 / DN-1
  });
});
