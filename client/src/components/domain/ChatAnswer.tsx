/**
 * ChatAnswer — renders one server answer, narrowed on `intent`.
 *
 * Every number on screen comes from the typed result set; the `summary` string
 * was built by a server-side template. Nothing here is model-generated, which
 * is the property the whole feature is built around — so this component must
 * never interpolate free text from anywhere but `summary`.
 *
 * Rows reuse the existing product/ledger wire shapes, so money is already a
 * 2-dp string and passes straight to `formatMoney`. Never `Number(price)`.
 */
import { Link } from 'react-router-dom';

import type { ChatResponse } from '../../api/chat';
import type { components } from '../../types/api';
import { formatDateTime, formatMoney } from '../../lib/formatters';
import { selectCurrency, useSettingsStore } from '../../stores/settingsStore';
import { DataTable, type ColumnDef } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { StockStatusBadge } from './StockStatusBadge';

type ProductRow = components['schemas']['ProductRow'];
type TransactionRow = components['schemas']['TransactionRow'];

export interface ChatAnswerProps {
  answer: ChatResponse;
  /** Clicking an example question re-asks it — the recovery path, made live. */
  onAskExample: (question: string) => void;
}

export function ChatAnswer({ answer, onAskExample }: ChatAnswerProps) {
  return (
    <div className="space-y-3">
      {/* `whitespace-pre-line` — the unsupported template is a bulleted list. */}
      <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-800">
        {answer.summary}
      </p>

      {answer.intent === 'product_lookup' && <ProductTable rows={answer.products} />}

      {answer.intent === 'low_stock' && (
        <div className="space-y-4">
          {/* Out-of-stock FIRST: it is the more urgent bucket, and putting it
              second buries it under a longer low-stock list. */}
          {answer.out.length > 0 && <ProductTable rows={answer.out} caption="Out of stock" />}
          {answer.low.length > 0 && (
            <ProductTable rows={answer.low} caption="Below reorder level" />
          )}
        </div>
      )}

      {answer.intent === 'movement_history' && (
        <div className="space-y-3">
          <ProductTable rows={[answer.product]} caption="Product" />
          <MovementTable rows={answer.movements} />
        </div>
      )}

      {answer.intent === 'clarify' && answer.candidates.length > 0 && (
        <ProductTable rows={answer.candidates} caption="Did you mean" />
      )}

      {answer.examples.length > 0 && (
        <ExampleQuestions examples={answer.examples} onAsk={onAskExample} />
      )}
    </div>
  );
}

function ProductTable({ rows, caption }: { rows: ProductRow[]; caption?: string }) {
  const currency = useSettingsStore(selectCurrency);

  const columns: ColumnDef<ProductRow>[] = [
    {
      key: 'sku',
      header: 'SKU',
      render: (row) => (
        <Link to={`/products/${row.id}`} className="text-brand-700 hover:underline">
          {row.sku}
        </Link>
      ),
    },
    { key: 'name', header: 'Name', render: (row) => row.name },
    { key: 'category', header: 'Category', render: (row) => row.categoryName ?? '—' },
    { key: 'quantity', header: 'Qty', align: 'right', render: (row) => row.quantity },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (row) => formatMoney(row.sellingPrice, currency),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StockStatusBadge status={row.stockStatus} isArchived={row.isArchived} />,
    },
  ];

  return (
    <section className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
      {caption !== undefined && (
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          {caption}
        </h3>
      )}
      {/* DataTable switches to its wide layout on VIEWPORT width, not container
          width, so inside a fixed-width panel a long row must scroll HERE
          rather than stretch the panel or clip silently. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          emptyState={<EmptyState message="No products to show." />}
          mobileCard={(row) => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/products/${row.id}`} className="font-medium text-brand-700">
                  {row.name}
                </Link>
                <StockStatusBadge status={row.stockStatus} isArchived={row.isArchived} />
              </div>
              <p className="text-xs text-neutral-500">{row.sku}</p>
              <p className="text-sm text-neutral-800">
                {row.quantity} on hand · {formatMoney(row.sellingPrice, currency)}
              </p>
            </div>
          )}
        />
      </div>
    </section>
  );
}

function MovementTable({ rows }: { rows: TransactionRow[] }) {
  const columns: ColumnDef<TransactionRow>[] = [
    { key: 'date', header: 'Date', render: (row) => formatDateTime(row.createdAt) },
    { key: 'type', header: 'Type', render: (row) => row.type },
    {
      key: 'change',
      header: 'Change',
      align: 'right',
      // The sign is the direction (BR-12) — show it explicitly rather than
      // making the reader infer it from the type column.
      render: (row) => (row.quantityChange > 0 ? `+${row.quantityChange}` : row.quantityChange),
    },
    { key: 'after', header: 'Qty after', align: 'right', render: (row) => row.quantityAfter },
    { key: 'user', header: 'User', render: (row) => row.userName },
  ];

  return (
    <section className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
      <div className="-mx-1 overflow-x-auto px-1">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          emptyState={<EmptyState message="No movements in this window." />}
          mobileCard={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-neutral-900">{row.type}</span>
                <span className="text-sm">
                  {row.quantityChange > 0 ? `+${row.quantityChange}` : row.quantityChange}
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                {formatDateTime(row.createdAt)} · {row.userName} · {row.quantityAfter} after
              </p>
            </div>
          )}
        />
      </div>
    </section>
  );
}

function ExampleQuestions({
  examples,
  onAsk,
}: {
  examples: string[];
  onAsk: (question: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {examples.map((example) => (
        <button
          key={example}
          type="button"
          onClick={() => onAsk(example)}
          className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs text-brand-800 transition-colors hover:bg-brand-100"
        >
          {example}
        </button>
      ))}
    </div>
  );
}
