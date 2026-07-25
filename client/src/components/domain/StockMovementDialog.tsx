/**
 * StockMovementDialog — UCA §5.1 / WIR §17.1 (F6). Records a STOCK_IN / STOCK_OUT
 * movement. Opened WITH a product (Detail/Scanner) skips straight to the form;
 * opened WITHOUT one (Dashboard quick action) renders Step 0 ProductPicker first.
 *
 *  - BR-15 large-movement guard: a quantity above the settings warning threshold
 *    requires an explicit confirm checkbox before submit.
 *  - BR-11 INSUFFICIENT_STOCK renders the server's authoritative `available`
 *    inline (never a toast); PRODUCT_ARCHIVED / IDEMPOTENCY_CONFLICT surface as
 *    the dialog's form error.
 *  - useIdempotencyKey: retries reuse the same key (server replays); the key
 *    resets on open, confirmed success, and cancel.
 */
import { useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../../api/client';
import { recordMovement, type MovementResponse } from '../../api/movements';
import { messageFor } from '../../lib/errorMap';
import { movementSchema } from '../../lib/validation/schemas/movements';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { selectWarningThreshold, useSettingsStore } from '../../stores/settingsStore';
import { FormField, fieldAria } from '../ui/FormField';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { SubmitRow } from '../ui/SubmitRow';
import { ProductPicker, type PickedProduct } from './ProductPicker';

export interface StockMovementDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present ⇒ skip Step 0. Absent ⇒ pick a product first (context-free entry). */
  product?: PickedProduct | undefined;
  defaultType?: 'STOCK_IN' | 'STOCK_OUT' | undefined;
  onCompleted: (result: MovementResponse) => void;
}

type FieldErrors = Record<string, string>;

export function StockMovementDialog({
  open,
  onClose,
  product,
  defaultType = 'STOCK_IN',
  onCompleted,
}: StockMovementDialogProps) {
  const warnThreshold = useSettingsStore(selectWarningThreshold);
  const idempotencyKey = useIdempotencyKey();

  const [selected, setSelected] = useState<PickedProduct | null>(product ?? null);
  const [type, setType] = useState<'STOCK_IN' | 'STOCK_OUT'>(defaultType);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [warnAck, setWarnAck] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(product ?? null);
    setType(defaultType);
    setQuantity('');
    setNote('');
    setWarnAck(false);
    setErrors({});
    setFormError(undefined);
    idempotencyKey.reset();
  }, [open, product, defaultType, idempotencyKey]);

  function close() {
    idempotencyKey.reset();
    onClose();
  }

  const qty = Number(quantity);
  const needsWarn = warnThreshold !== null && Number.isFinite(qty) && qty > warnThreshold;

  function applyServerError(error: ApiError): boolean {
    if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
      const next: FieldErrors = {};
      for (const item of error.details as { field: string; message: string }[]) {
        next[item.field] ??= item.message;
      }
      setErrors(next);
      return true;
    }
    if (error.code === 'INSUFFICIENT_STOCK') {
      const available = (error.details as { available?: number } | undefined)?.available;
      setErrors({ quantity: `Only ${available ?? 0} available.` });
      return true;
    }
    return false;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    if (!selected) return;

    const body = {
      type,
      productId: selected.id,
      quantity: qty,
      ...(note.trim() ? { note } : {}),
    };
    const parsed = movementSchema.safeParse(body);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    if (needsWarn && !warnAck) {
      setErrors({ quantity: '' });
      return; // the warning checkbox gates submit (BR-15)
    }

    setErrors({});
    setLoading(true);
    try {
      const result = await recordMovement(parsed.data, idempotencyKey.current());
      idempotencyKey.reset();
      onCompleted(result);
    } catch (error) {
      if (error instanceof ApiError && !applyServerError(error)) {
        setFormError(messageFor(error.code));
      } else if (!(error instanceof ApiError)) {
        setFormError(messageFor('INTERNAL_ERROR'));
      }
    } finally {
      setLoading(false);
    }
  }

  const title = selected
    ? `Stock ${type === 'STOCK_IN' ? 'In' : 'Out'} — ${selected.name}`
    : 'New movement';

  return (
    <Modal open={open} onClose={close} title={title} dismissOnOverlay={false}>
      {!selected ? (
        <ProductPicker onSelect={setSelected} />
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-3">
          {formError && (
            <p role="alert" className="text-sm text-danger-600">
              {formError}
            </p>
          )}

          <div className="flex gap-2" role="radiogroup" aria-label="Movement direction">
            {(['STOCK_IN', 'STOCK_OUT'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={type === option}
                onClick={() => setType(option)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  type === option
                    ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                    : 'border-gray-300 text-gray-700'
                }`}
              >
                {option === 'STOCK_IN' ? 'Stock In' : 'Stock Out'}
              </button>
            ))}
          </div>

          <p className="text-sm text-gray-500">Current quantity: {selected.quantity}</p>

          <FormField label="Quantity" htmlFor="movement-quantity" error={errors.quantity} required>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              {...fieldAria('movement-quantity', errors.quantity)}
            />
          </FormField>

          <FormField label="Note" htmlFor="movement-note" error={errors.note}>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              {...fieldAria('movement-note', errors.note)}
            />
          </FormField>

          {needsWarn && (
            <label className="flex items-start gap-2 rounded-md bg-warning-100 p-2 text-sm text-warning-700">
              <input
                type="checkbox"
                checked={warnAck}
                onChange={(e) => setWarnAck(e.target.checked)}
                className="mt-0.5"
              />
              <span>Large movement of {qty} units — confirm this is intentional.</span>
            </label>
          )}

          <SubmitRow onCancel={close} submitLabel="Confirm" loading={loading} />
        </form>
      )}
    </Modal>
  );
}
