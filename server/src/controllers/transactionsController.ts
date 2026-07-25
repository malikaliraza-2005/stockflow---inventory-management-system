/**
 * Transactions controller — HTTP concerns only (BEA §2): validated query → the
 * TransactionService list → serialized ledger rows in the §5 list envelope.
 */
import type { RequestHandler } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { serializeTransactionRow } from '../serializers/transaction.js';
import type { TransactionService } from '../services/TransactionService.js';
import type { TransactionsQuery } from '../validation/schemas/transactions.js';

export function createTransactionsController(transactionService: TransactionService) {
  const list: RequestHandler = asyncHandler(async (req, res) => {
    const { products, users, ...envelope } = await transactionService.list(
      req.query as unknown as TransactionsQuery,
    );
    res.json({
      ...envelope,
      data: envelope.data.map((row) =>
        serializeTransactionRow(row, {
          product: products.get(row.productId.toString()),
          user: users.get(row.userId.toString()),
        }),
      ),
    });
  });

  return { list };
}
