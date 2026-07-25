/**
 * ProductPicker — UCA §5.2: debounced search-select, the movement dialogs' Step 0
 * (context-free entry, WIR §17.1). Lists active products by name/SKU; selecting
 * one hands its id + display fields back to the parent dialog, which owns the
 * movement orchestration (UCA §7 — no domain component renders another's dialog).
 */
import { useCallback, useState } from 'react';

import { listProducts } from '../../api/products';
import { EmptyState } from '../ui/EmptyState';
import { SearchInput } from '../ui/SearchInput';
import { Spinner } from '../ui/Spinner';
import { useQueryState } from '../../hooks/useQueryState';

export interface PickedProduct {
  id: string;
  name: string;
  sku: string;
  quantity: number;
}

export interface ProductPickerProps {
  onSelect: (product: PickedProduct) => void;
}

export function ProductPicker({ onSelect }: ProductPickerProps) {
  const [search, setSearch] = useState('');
  const query = useCallback(
    () => listProducts({ search: search || undefined, limit: 10 }),
    [search],
  );
  const { data, loading } = useQueryState(query, [search]);

  return (
    <div className="space-y-3">
      <SearchInput
        value={search}
        onDebouncedChange={setSearch}
        placeholder="Search by name or SKU"
        label="Find a product"
      />
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : data && data.data.length === 0 ? (
        <EmptyState message="No products found." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data?.data.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() =>
                  onSelect({
                    id: product.id,
                    name: product.name,
                    sku: product.sku,
                    quantity: product.quantity,
                  })
                }
                className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-gray-50"
              >
                <span>
                  <span className="font-medium text-gray-900">{product.name}</span>{' '}
                  <span className="font-mono text-xs text-gray-500">{product.sku}</span>
                </span>
                <span className="text-sm text-gray-500">{product.quantity} in stock</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
