/**
 * ChatService — the fallback ladder and the four target questions, end-to-end
 * against REAL services and a REAL (memory) Mongo, with a scripted LLM.
 *
 * All eight fallback cases run here in milliseconds because the only thing
 * faked is the classification. That is the whole point of putting the vendor
 * boundary at one method: the interesting behaviour — handlers, templates,
 * RBAC, tenant scoping — is exercised for real.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ServiceUnavailableError } from '../../src/errors/AppError.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Category } from '../../src/models/Category.js';
import { Product } from '../../src/models/Product.js';
import { Settings } from '../../src/models/Settings.js';
import { Transaction } from '../../src/models/Transaction.js';
import { AuditService } from '../../src/services/AuditService.js';
import { ChatService, type ChatAsk } from '../../src/services/ChatService.js';
import { MovementService } from '../../src/services/MovementService.js';
import { ProductService } from '../../src/services/ProductService.js';
import { TransactionService } from '../../src/services/TransactionService.js';
import { LlmProviderError } from '../../src/services/llm/types.js';
import { makeFakeProvider, makeFakeScript } from '../../src/services/llm/providers/fake.js';
import { useTestTenant } from '../helpers/tenant.js';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });
const actorId = new Types.ObjectId();
let categoryId: string;

useTestTenant();

/** Captures the structured record so the logging contract is testable. */
function captureLogger() {
  const records: Record<string, unknown>[] = [];
  const child = {
    ...logger,
    info: (obj: unknown) => {
      if (obj && typeof obj === 'object' && 'chat' in obj) {
        records.push((obj as { chat: Record<string, unknown> }).chat);
      }
    },
  } as unknown as ChatAsk['logger'];
  return { child, records };
}

function makeChat(responses: (string | Error)[], now = new Date('2026-07-29T12:00:00.000Z')) {
  const audit = new AuditService(logger);
  const movement = new MovementService({ audit });
  const script = makeFakeScript(responses);
  const service = new ChatService({
    llm: makeFakeProvider(script),
    products: new ProductService({ audit, movement }),
    transactions: new TransactionService(),
    config: { maxTokens: 256, timeoutMs: 2_000 },
    now: () => now,
  });
  return { service, script, movement };
}

const captured = captureLogger();

function ask(question: string, role: 'ADMIN' | 'STAFF' = 'STAFF'): ChatAsk {
  return {
    question,
    conversationId: '3f1c2b7a-0000-4000-8000-000000000001',
    actor: { id: actorId.toString(), role },
    correlationId: 'corr-1',
    requestId: 'req-1',
    logger: captured.child,
  };
}

async function makeProduct(
  name: string,
  quantity: number,
  lowStockThreshold = 5,
): Promise<Types.ObjectId> {
  const audit = new AuditService(logger);
  const service = new ProductService({ audit, movement: new MovementService({ audit }) });
  const { product } = await service.create(
    {
      name,
      categoryId,
      costPrice: '10.00',
      sellingPrice: '15.50',
      initialQuantity: quantity,
      lowStockThreshold,
    } as Parameters<ProductService['create']>[0],
    actorId,
  );
  return product._id;
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
  captured.records.length = 0;
  const category = await Category.create({ name: 'Electronics' });
  categoryId = category._id.toString();
});

// ── the four target questions ───────────────────────────────────────────

describe('the four target questions answer end-to-end', () => {
  it('"How many laptops are available?" — count + real quantities', async () => {
    await makeProduct('Dell Laptop 15', 20);
    await makeProduct('HP Laptop 14', 27);
    const { service } = makeChat(['{"intent":"product_lookup","productQuery":"laptop"}']);

    const result = await service.ask(ask('How many laptops are available?'));

    expect(result.intent).toBe('product_lookup');
    expect(result.summary).toBe('Found 2 products matching "laptop". Total on hand: 47 units.');
    if (result.intent !== 'product_lookup') throw new Error('unreachable');
    expect(result.products).toHaveLength(2);
    // Quantities are the STORED values, not a ledger recomputation.
    expect(result.products.map((p) => p.quantity).sort()).toEqual([20, 27]);
  });

  it('"Which products are below reorder level?" — two buckets, not one number', async () => {
    await makeProduct('Low Widget', 3, 5); // 0 < q <= threshold → low
    await makeProduct('Empty Widget', 0, 5); // q == 0            → out
    await makeProduct('Fine Widget', 50, 5);
    const { service } = makeChat(['{"intent":"low_stock"}']);

    const result = await service.ask(ask('Which products are below reorder level?'));

    expect(result.summary).toBe(
      '1 product is at or below its reorder level, and 1 is out of stock.',
    );
    if (result.intent !== 'low_stock') throw new Error('unreachable');
    expect(result.low.map((p) => p.name)).toEqual(['Low Widget']);
    expect(result.out.map((p) => p.name)).toEqual(['Empty Widget']);
  });

  it('"Show me inventory of Dell laptops." — the same intent, brand-qualified', async () => {
    await makeProduct('Dell XPS 15', 4);
    const { service } = makeChat(['{"intent":"product_lookup","productQuery":"Dell"}']);

    const result = await service.ask(ask('Show me inventory of Dell laptops.'));

    expect(result.summary).toBe('Found 1 product matching "Dell". Total on hand: 4 units.');
  });

  it('"What was the stock movement history?" — resolved product + real ledger rows', async () => {
    const productId = await makeProduct('Dell XPS 15', 10);
    const { service, movement } = makeChat([
      '{"intent":"movement_history","productQuery":"Dell XPS 15","period":"last_30_days"}',
    ]);
    await movement.recordMovement({
      idempotencyKey: '9f1c2b7a-0000-4000-8000-00000000000a',
      input: { type: 'STOCK_IN', productId: productId.toString(), quantity: 5 },
      actorId,
    } as Parameters<MovementService['recordMovement']>[0]);

    const result = await service.ask(ask('What was the stock movement history for Dell XPS 15?'));

    if (result.intent !== 'movement_history') throw new Error(`got ${result.intent}`);
    expect(result.product.name).toBe('Dell XPS 15');
    expect(result.summary).toBe(
      '2 stock movements for "Dell XPS 15" in the last 30 days: 1 opening stock, 1 stock-in.',
    );
    expect(result.movements).toHaveLength(2);
  });
});

// ── the fallback ladder, one test per case ──────────────────────────────

describe('fallback ladder — every case is named, tested and logged', () => {
  it('JSON_PARSE_FAILED: reparses once, then answers unsupported', async () => {
    const { service, script } = makeChat(['I think you want laptops!', 'still not json']);

    const result = await service.ask(ask('how many laptops'));

    expect(result.intent).toBe('unsupported');
    expect(script.calls).toHaveLength(2); // one reparse retry, not a loop
    expect(captured.records[0]?.fallback).toEqual({
      type: 'JSON_PARSE_FAILED',
      details: 'reparse_exhausted',
    });
  });

  it('JSON_PARSE_FAILED: recovers when the reparse succeeds', async () => {
    const { service } = makeChat(['sorry, here you go:', '{"intent":"low_stock"}']);
    const result = await service.ask(ask('what needs reordering'));
    expect(result.intent).toBe('low_stock');
    expect(captured.records[0]?.fallback).toBeNull();
  });

  it('tolerates markdown fences without spending the retry', async () => {
    const { service, script } = makeChat(['```json\n{"intent":"low_stock"}\n```']);
    const result = await service.ask(ask('what needs reordering'));
    expect(result.intent).toBe('low_stock');
    expect(script.calls).toHaveLength(1);
  });

  it('SCHEMA_VALIDATION_FAILED: an invented slot key is caught, not ignored', async () => {
    const { service } = makeChat([
      '{"intent":"product_lookup","productQuery":"Dell","sortBy":"price"}',
    ]);

    const result = await service.ask(ask('cheapest dell'));

    expect(result.intent).toBe('unsupported');
    const fallback = captured.records[0]?.fallback as { type: string; details: string };
    expect(fallback.type).toBe('SCHEMA_VALIDATION_FAILED');
    // Machine-shaped diagnostics only — never the user's question.
    expect(fallback.details).toContain('sortBy');
    expect(JSON.stringify(fallback)).not.toContain('cheapest dell');
  });

  it('SCHEMA_VALIDATION_FAILED: an unknown intent cannot reach a handler', async () => {
    const { service } = makeChat(['{"intent":"delete_all_products"}']);
    const result = await service.ask(ask('delete everything'));
    expect(result.intent).toBe('unsupported');
    expect((captured.records[0]?.fallback as { type: string }).type).toBe(
      'SCHEMA_VALIDATION_FAILED',
    );
  });

  it('SLOT_MISSING: history without a product asks which one', async () => {
    const { service } = makeChat(['{"intent":"movement_history"}']);

    const result = await service.ask(ask('what happened recently'));

    expect(result.intent).toBe('clarify');
    expect(result.summary).toContain('Which product did you mean?');
    expect(result.examples.length).toBeGreaterThan(0); // a dead end always offers a way out
    expect(captured.records[0]?.fallback).toEqual({
      type: 'SLOT_MISSING',
      details: 'productQuery',
    });
  });

  it('NO_RESULTS: names what was searched and suggests a shorter term', async () => {
    await makeProduct('Dell XPS 15', 3);
    const { service } = makeChat(['{"intent":"product_lookup","productQuery":"Lenovo"}']);

    const result = await service.ask(ask('do we have any lenovo'));

    expect(result.summary).toContain('No products matched "Lenovo"');
    expect(captured.records[0]).toMatchObject({ resultCount: 0 });
    expect((captured.records[0]?.fallback as { type: string }).type).toBe('NO_RESULTS');
  });

  it('TOO_MANY_RESULTS: states the total and shows the first ten', async () => {
    for (let i = 0; i < 12; i++) await makeProduct(`Widget ${String(i).padStart(2, '0')}`, 1);
    const { service } = makeChat(['{"intent":"product_lookup","productQuery":"Widget"}']);

    const result = await service.ask(ask('show me widgets'));

    if (result.intent !== 'product_lookup') throw new Error('unreachable');
    expect(result.totalCount).toBe(12);
    expect(result.products).toHaveLength(10);
    expect(result.summary).toBe(
      'Found 12 products matching "Widget" — showing the first 10. Add a brand or category to narrow it down.',
    );
    expect((captured.records[0]?.fallback as { type: string }).type).toBe('TOO_MANY_RESULTS');
  });

  it('AMBIGUOUS_PRODUCT: lists candidates instead of guessing', async () => {
    await makeProduct('Dell XPS 13', 1);
    await makeProduct('Dell XPS 15', 1);
    await makeProduct('Dell Latitude', 1);
    const { service } = makeChat(['{"intent":"movement_history","productQuery":"Dell"}']);

    const result = await service.ask(ask('history for dell'));

    expect(result.intent).toBe('clarify');
    expect(result.summary).toBe('I found 3 products matching "Dell". Which one did you mean?');
    if (result.intent !== 'clarify') throw new Error('unreachable');
    expect(result.candidates).toHaveLength(3);
    expect((captured.records[0]?.fallback as { type: string }).type).toBe('AMBIGUOUS_PRODUCT');
  });

  it('AMBIGUOUS_PRODUCT: an EXACT name match is not ambiguity', async () => {
    await makeProduct('Dell XPS 15', 1);
    await makeProduct('Dell XPS 15 Dock', 1);
    const { service } = makeChat(['{"intent":"movement_history","productQuery":"Dell XPS 15"}']);

    const result = await service.ask(ask('history for the XPS 15'));

    expect(result.intent).toBe('movement_history');
    if (result.intent !== 'movement_history') throw new Error('unreachable');
    expect(result.product.name).toBe('Dell XPS 15');
  });

  it('FORBIDDEN: refused before the handler runs', async () => {
    await makeProduct('Dell XPS 15', 1);
    const { service } = makeChat(['{"intent":"movement_history","productQuery":"Dell XPS 15"}']);

    // `transactions.view` is STAFF-accessible today, so force the denial by
    // asking as a role the matrix does not list — the wiring is what's under
    // test, not today's matrix row.
    const result = await service.ask({
      ...ask('history for the XPS 15'),
      actor: { id: actorId.toString(), role: 'VIEWER' as never },
    });

    expect(result.intent).toBe('unsupported');
    expect(result.summary).toContain("don't have permission");
    expect(captured.records[0]?.fallback).toEqual({
      type: 'FORBIDDEN',
      details: 'transactions.view',
    });
    expect(captured.records[0]).toMatchObject({ resultCount: 0 });
  });

  it('PROVIDER_UNAVAILABLE: a 429 becomes a clean 503, never a 500 — and is NOT retried', async () => {
    const { service, script } = makeChat([
      new LlmProviderError('quota exhausted', { retryable: false, status: 429 }),
    ]);

    await expect(service.ask(ask('how many laptops'))).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );

    expect(script.calls).toHaveLength(1); // zero retries on 4xx — retrying burns quota
    expect(captured.records[0]?.fallback).toEqual({
      type: 'PROVIDER_UNAVAILABLE',
      details: 'status:429',
    });
  });

  it('PROVIDER_UNAVAILABLE: a 5xx is retried exactly once', async () => {
    const { service, script } = makeChat([
      new LlmProviderError('upstream 503', { retryable: true, status: 503 }),
      '{"intent":"low_stock"}',
    ]);

    const result = await service.ask(ask('what needs reordering'));

    expect(result.intent).toBe('low_stock');
    expect(script.calls).toHaveLength(2);
  });

  it('PROVIDER_UNAVAILABLE: a timeout gives up after the one retry', async () => {
    const { service, script } = makeChat([
      new LlmProviderError('timeout', { retryable: true }),
      new LlmProviderError('timeout', { retryable: true }),
    ]);

    await expect(service.ask(ask('how many laptops'))).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect(script.calls).toHaveLength(2);
  });
});

// ── slot handling + the log record ──────────────────────────────────────

describe('slot normalisation (the real-world failure mode)', () => {
  it('retries the singular when a plural slot returns nothing', async () => {
    await makeProduct('Laptop Stand', 6);
    const { service } = makeChat(['{"intent":"product_lookup","productQuery":"Laptop Stands"}']);

    const result = await service.ask(ask('how many laptop stands'));

    if (result.intent !== 'product_lookup') throw new Error('unreachable');
    expect(result.totalCount).toBe(1);
    expect(result.summary).toContain('Laptop Stand');
  });

  it('resolves a category NAME to an id, and falls back to search when it is not one', async () => {
    await makeProduct('Dell XPS 15', 2);
    const { service } = makeChat([
      '{"intent":"product_lookup","categoryName":"Electronics"}',
      '{"intent":"product_lookup","categoryName":"Gizmos"}',
    ]);

    // Resolved to a category id ⇒ "in", not "matching": the sentence describes
    // the query the server actually ran.
    const byCategory = await service.ask(ask('show me electronics'));
    expect(byCategory.summary).toBe('Found 1 product in "Electronics". Total on hand: 2 units.');

    const byFallback = await service.ask(ask('show me gizmos'));
    expect(byFallback.summary).toContain('No products matched "Gizmos"');
  });
});

describe('the structured log record', () => {
  it('carries every field the alerts and the eval loop need', async () => {
    await makeProduct('Dell XPS 15', 3);
    const { service } = makeChat(['{"intent":"product_lookup","productQuery":"Dell"}']);

    await service.ask(ask('how many dell'));

    const record = captured.records[0] ?? {};
    expect(record).toMatchObject({
      correlationId: 'corr-1',
      conversationId: '3f1c2b7a-0000-4000-8000-000000000001',
      userId: actorId.toString(),
      question: 'how many dell',
      intent: 'product_lookup',
      slots: { productQuery: 'Dell' },
      fallback: null, // explicit, so "answered normally" is filterable
      resultCount: 1,
      provider: 'fake',
      promptVersion: 'v1',
    });
    expect(record['tenantId']).toBe('aaaaaaaaaaaaaaaaaaaaaaa1');
    // Latency is SPLIT: "provider or database?" is always the first question.
    expect(typeof record['llmMs']).toBe('number');
    expect(typeof record['handlerMs']).toBe('number');
    expect(typeof record['totalMs']).toBe('number');
  });
});
