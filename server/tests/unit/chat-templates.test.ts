/**
 * The assistant's ENTIRE user-facing output, pinned.
 *
 * These strings are the product surface in Phase 1 — there is no LLM
 * response-generation step — so a wording change must show up in a diff and be
 * reviewed like any other user-visible change. Pinned literally rather than via
 * an opaque snapshot file so the reviewer reads the sentence in the diff.
 */
import { describe, expect, it } from 'vitest';

import {
  ambiguousProduct,
  forbiddenSummary,
  lowStockSummary,
  missingProductSlot,
  movementBreakdown,
  movementHistoryEmpty,
  movementHistoryFound,
  plural,
  productLookupEmpty,
  productLookupFound,
  productLookupTruncated,
  unsupportedSummary,
} from '../../src/services/chat/templates.js';
import { periodLabel, resolvePeriod } from '../../src/services/chat/period.js';

const term = (value: string) => ({ kind: 'term', value }) as const;
const category = (value: string) => ({ kind: 'category', value }) as const;

describe('product_lookup templates', () => {
  it('states the count and the total on hand when every match is on screen', () => {
    expect(productLookupFound({ scope: term('Dell'), totalCount: 3, totalOnHand: 47 })).toBe(
      'Found 3 products matching "Dell". Total on hand: 47 units.',
    );
  });

  it('is singular-correct for one product and one unit', () => {
    expect(productLookupFound({ scope: term('Dell'), totalCount: 1, totalOnHand: 1 })).toBe(
      'Found 1 product matching "Dell". Total on hand: 1 unit.',
    );
  });

  it('says "in" for a resolved category — the sentence describes the real query', () => {
    expect(
      productLookupFound({ scope: category('Electronics'), totalCount: 4, totalOnHand: 12 }),
    ).toBe('Found 4 products in "Electronics". Total on hand: 12 units.');
  });

  it('drops the clause entirely when the user scoped nothing', () => {
    expect(productLookupFound({ scope: { kind: 'all' }, totalCount: 4, totalOnHand: 12 })).toBe(
      'Found 4 products. Total on hand: 12 units.',
    );
  });

  it('states the truncation — never a silent cut', () => {
    expect(productLookupTruncated({ scope: term('a'), totalCount: 50, shown: 10 })).toBe(
      'Found 50 products matching "a" — showing the first 10. Add a brand or category to narrow it down.',
    );
  });

  it('names what was searched on a miss and offers a concrete next move', () => {
    expect(productLookupEmpty(term('Dell laptops'))).toBe(
      'No products matched "Dell laptops". Try a shorter term — a brand or product name usually works better than a full phrase.',
    );
    expect(productLookupEmpty(category('Electronics'))).toBe(
      'There are no products in "Electronics" right now.',
    );
    expect(productLookupEmpty({ kind: 'all' })).toBe('There are no products in the catalogue yet.');
  });
});

describe('low_stock templates — two buckets, never one number', () => {
  it('reports low and out separately', () => {
    expect(lowStockSummary({ lowCount: 3, outCount: 1 })).toBe(
      '3 products are at or below their reorder level, and 1 is out of stock.',
    );
  });

  it('handles each bucket alone, singular-correct', () => {
    expect(lowStockSummary({ lowCount: 1, outCount: 0 })).toBe(
      '1 product is at or below its reorder level.',
    );
    expect(lowStockSummary({ lowCount: 0, outCount: 2 })).toBe('2 products are out of stock.');
  });

  it('says nothing is low rather than reporting a zero', () => {
    expect(lowStockSummary({ lowCount: 0, outCount: 0 })).toBe(
      'Nothing is below its reorder level right now.',
    );
  });

  it('discloses truncation so nobody under-orders off a clipped list', () => {
    expect(lowStockSummary({ lowCount: 30, outCount: 5, shown: 10 })).toBe(
      '30 products are at or below their reorder level, and 5 are out of stock. Showing the 10 most urgent.',
    );
  });
});

describe('movement_history templates', () => {
  it('counts by type in a fixed order', () => {
    expect(movementBreakdown({ STOCK_IN: 8, STOCK_OUT: 3, ADJUSTMENT: 1 })).toBe(
      '8 stock-in, 3 stock-out, 1 adjustment',
    );
    expect(movementBreakdown({ ADJUSTMENT: 2, INITIAL: 1 })).toBe('1 opening stock, 2 adjustments');
    expect(movementBreakdown({})).toBe('');
  });

  it('renders the headline example from the design', () => {
    expect(
      movementHistoryFound({
        productName: 'Dell XPS 15',
        period: 'last_30_days',
        totalCount: 12,
        shown: 12,
        counts: { STOCK_IN: 8, STOCK_OUT: 3, ADJUSTMENT: 1 },
      }),
    ).toBe(
      '12 stock movements for "Dell XPS 15" in the last 30 days: 8 stock-in, 3 stock-out, 1 adjustment.',
    );
  });

  it('discloses truncation on a long history', () => {
    expect(
      movementHistoryFound({
        productName: 'Dell XPS 15',
        period: 'all',
        totalCount: 90,
        shown: 20,
        counts: { STOCK_IN: 20 },
      }),
    ).toBe(
      '90 stock movements for "Dell XPS 15" on record — showing the most recent 20: 20 stock-in.',
    );
  });

  it('names the product and the window on an empty history', () => {
    expect(movementHistoryEmpty('Dell XPS 15', 'last_7_days')).toBe(
      'No stock movements for "Dell XPS 15" in the last 7 days.',
    );
  });
});

describe('clarify / unsupported / forbidden templates', () => {
  it('asks which product rather than picking one', () => {
    expect(ambiguousProduct('Dell', 3)).toBe(
      'I found 3 products matching "Dell". Which one did you mean?',
    );
  });

  it('asks for the missing product slot', () => {
    expect(missingProductSlot()).toBe(
      "Which product did you mean? Name a product and I'll show its stock movement history.",
    );
  });

  it('lists the capabilities instead of apologising vaguely', () => {
    expect(unsupportedSummary()).toBe(
      "I can't answer that one. I can help with:\n" +
        '• finding products and their stock levels\n' +
        "• what's below reorder level\n" +
        '• stock movement history for a product',
    );
  });

  it('refuses without hinting at what was withheld', () => {
    expect(forbiddenSummary()).toBe(
      "You don't have permission to see that information. Ask an administrator if you need access.",
    );
  });
});

describe('pluralisation + period resolution', () => {
  it('pluralises regularly and irregularly', () => {
    expect(plural(1, 'product')).toBe('1 product');
    expect(plural(0, 'product')).toBe('0 products');
    expect(plural(2, 'adjustment', 'adjustments')).toBe('2 adjustments');
  });

  it('resolves buckets against the SERVER clock, never a model-computed date', () => {
    const now = new Date('2026-07-29T13:45:00.000Z');

    expect(resolvePeriod('last_7_days', now)).toEqual({ from: '2026-07-23', to: '2026-07-29' });
    expect(resolvePeriod('last_30_days', now)).toEqual({ from: '2026-06-30', to: '2026-07-29' });
    expect(resolvePeriod('this_month', now)).toEqual({ from: '2026-07-01', to: '2026-07-29' });
    expect(resolvePeriod('all', now)).toEqual({});
  });

  it('labels every bucket (no unlabelled period can reach a summary)', () => {
    expect(periodLabel('last_7_days')).toBe('in the last 7 days');
    expect(periodLabel('last_30_days')).toBe('in the last 30 days');
    expect(periodLabel('this_month')).toBe('this month');
    expect(periodLabel('all')).toBe('on record');
  });
});
