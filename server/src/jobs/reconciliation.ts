/**
 * Ledger reconciliation job — BR-18 / ARB-05. Compares each product's
 * materialized `quantity` against the sum of its ledger (`Σ quantityChange`).
 * MovementService is the sole writer and holds the invariant transactionally, so
 * a true drift is a red flag (a bug or an out-of-band write) — never expected.
 *
 * ARB-05: a product that looks drifted is RE-CHECKED once before flagging, since
 * a movement may have committed between the aggregate scan and the comparison.
 * Confirmed drift is a `warn` log (alert-worthy) and a report row — never an
 * exception (job failures never surface to users; the Admin Ledger Consistency
 * report, F10, is the UI). Reads ride `{productId, createdAt}` (DBD §2.4).
 */
import type { Types } from 'mongoose';

import type { Logger } from '../lib/logger.js';
import { Product } from '../models/Product.js';
import { Transaction } from '../models/Transaction.js';

export interface ReconcileDrift {
  productId: string;
  sku: string;
  quantity: number;
  ledgerSum: number;
}

export interface ReconcileReport {
  checked: number;
  drifted: ReconcileDrift[];
}

export interface ReconciliationDeps {
  logger: Pick<Logger, 'warn' | 'info'>;
}

export async function runReconciliation(deps: ReconciliationDeps): Promise<ReconcileReport> {
  const sums = await Transaction.aggregate<{ _id: Types.ObjectId; sum: number }>([
    { $group: { _id: '$productId', sum: { $sum: '$quantityChange' } } },
  ]);
  const sumByProduct = new Map(sums.map((s) => [s._id.toString(), s.sum]));

  const products = await Product.find().select('sku quantity').lean();
  const drifted: ReconcileDrift[] = [];

  for (const product of products) {
    const ledgerSum = sumByProduct.get(product._id.toString()) ?? 0;
    if (product.quantity === ledgerSum) continue;

    // ARB-05 — re-check once; a movement may have landed mid-scan.
    const confirmed = await recheck(product._id);
    if (confirmed && confirmed.quantity !== confirmed.ledgerSum) {
      deps.logger.warn(confirmed, 'ledger drift detected (BR-18) — quantity != Σ ledger');
      drifted.push(confirmed);
    }
  }

  deps.logger.info(
    { checked: products.length, drifted: drifted.length },
    'reconciliation complete',
  );
  return { checked: products.length, drifted };
}

async function recheck(productId: Types.ObjectId): Promise<ReconcileDrift | null> {
  const [product, sumRows] = await Promise.all([
    Product.findById(productId).select('sku quantity').lean(),
    Transaction.aggregate<{ sum: number }>([
      { $match: { productId } },
      { $group: { _id: null, sum: { $sum: '$quantityChange' } } },
    ]),
  ]);
  if (!product) return null;
  return {
    productId: productId.toString(),
    sku: product.sku,
    quantity: product.quantity,
    ledgerSum: sumRows[0]?.sum ?? 0,
  };
}
