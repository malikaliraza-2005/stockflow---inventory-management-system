/**
 * ReassignDeleteModal — UCA §5 / WIR §10 (F3). Two flows:
 *  - the category has products → "{n} products use {name}. Reassign to: ▾"
 *    (default Uncategorized), destructive button "Reassign & delete" (T5).
 *  - the category is empty → a plain delete confirm.
 *
 * The reassign targets are the full category list (fetched on open) minus this
 * one; Uncategorized (the system category) is the default. Destructive flow →
 * overlay dismissal off (accidental-loss guard); destructive button last (NFR-32).
 */
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import { deleteCategory, listCategories, type Category } from '../../api/categories';
import { messageFor } from '../../lib/errorMap';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';
import { Modal } from '../ui/Modal';

export interface ReassignDeleteModalProps {
  open: boolean;
  /** The category to delete — carries productCount from the withCounts list. */
  category: Category | null;
  onClose: () => void;
  onDeleted: () => void;
}

export function ReassignDeleteModal({
  open,
  category,
  onClose,
  onDeleted,
}: ReassignDeleteModalProps) {
  const productCount = category?.productCount ?? 0;
  const needsReassign = productCount > 0;

  const [targets, setTargets] = useState<Category[]>([]);
  const [reassignTo, setReassignTo] = useState<string>('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  // Fetch the reassignment targets once the destructive flow opens.
  useEffect(() => {
    setError(undefined);
    if (!open || !category || !needsReassign) return;
    let cancelled = false;
    void listCategories({ limit: 100, sort: 'name', order: 'asc' }).then((res) => {
      if (cancelled) return;
      const others = res.data.filter((c) => c.id !== category.id);
      setTargets(others);
      const uncategorized = others.find((c) => c.isSystem);
      setReassignTo(uncategorized?.id ?? others[0]?.id ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [open, category, needsReassign]);

  if (!category) return null;

  async function handleDelete() {
    if (!category) return;
    setError(undefined);
    setLoading(true);
    try {
      await deleteCategory(category.id, needsReassign ? reassignTo : undefined);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? messageFor(err.code) : messageFor('INTERNAL_ERROR'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete ${category.name}`}
      size="sm"
      dismissOnOverlay={false}
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-danger-600">
            {error}
          </p>
        )}

        {needsReassign ? (
          <>
            <p className="text-sm text-gray-700">
              {productCount} {productCount === 1 ? 'product uses' : 'products use'}{' '}
              <span className="font-medium">{category.name}</span>. Reassign them before deleting.
            </p>
            <FormField label="Reassign products to" htmlFor="reassign-target">
              <select
                id="reassign-target"
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
          </>
        ) : (
          <p className="text-sm text-gray-700">
            Delete <span className="font-medium">{category.name}</span>? This can’t be undone.
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleDelete()}
            loading={loading}
            disabled={needsReassign && !reassignTo}
          >
            {needsReassign ? 'Reassign & delete' : 'Delete'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
