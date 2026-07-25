/**
 * AdjustmentDialog — UCA §5.2 / WIR §17.2 (F6, Admin-only). Records an ADJUSTMENT
 * in one of two modes: a signed `delta`, or an absolute `countedQuantity` from
 * which the server derives the delta. A reason code is mandatory; `OTHER`
 * additionally requires a note. Same warning/error states as StockMovementDialog
 * (BR-13/BR-15). Opened without a product renders Step 0 ProductPicker first.
 */
import { useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../../api/client';
import { recordMovement, type MovementResponse } from '../../api/movements';
import { messageFor } from '../../lib/errorMap';
import { ADJUSTMENT_REASONS, movementSchema } from '../../lib/validation/schemas/movements';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { selectWarningThreshold, useSettingsStore } from '../../stores/settingsStore';
import { FormField, fieldAria } from '../ui/FormField';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { SubmitRow } from '../ui/SubmitRow';
import { ProductPicker, type PickedProduct } from './ProductPicker';

export interface AdjustmentDialogProps {
  open: boolean;
  onClose: () => void;
  product?: PickedProduct | undefined;
  onCompleted: (result: MovementResponse) => void;
}

type FieldErrors = Record<string, string>;
type Mode = 'delta' | 'counted';

const REASON_LABELS: Record<(typeof ADJUSTMENT_REASONS)[number], string> = {
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  FOUND: 'Found',
  COUNT_CORRECTION: 'Count correction',
  RETURN: 'Return',
  OTHER: 'Other',
};

export function AdjustmentDialog({ open, onClose, product, onCompleted }: AdjustmentDialogProps) {
  const warnThreshold = useSettingsStore(selectWarningThreshold);
  const idempotencyKey = useIdempotencyKey();

  const [selected, setSelected] = useState<PickedProduct | null>(product ?? null);
  const [mode, setMode] = useState<Mode>('delta');
  const [delta, setDelta] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState<'' | (typeof ADJUSTMENT_REASONS)[number]>('');
  const [note, setNote] = useState('');
  const [warnAck, setWarnAck] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(product ?? null);
    setMode('delta');
    setDelta('');
    setCounted('');
    setReason('');
    setNote('');
    setWarnAck(false);
    setErrors({});
    setFormError(undefined);
    idempotencyKey.reset();
  }, [open, product, idempotencyKey]);

  function close() {
    idempotencyKey.reset();
    onClose();
  }

  const changeMagnitude =
    mode === 'delta'
      ? Math.abs(Number(delta))
      : selected
        ? Math.abs(Number(counted) - selected.quantity)
        : 0;
  const needsWarn =
    warnThreshold !== null && Number.isFinite(changeMagnitude) && changeMagnitude > warnThreshold;

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
      setErrors({ delta: `Only ${available ?? 0} in stock — cannot go below zero.` });
      return true;
    }
    return false;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    if (!selected) return;

    const body = {
      type: 'ADJUSTMENT' as const,
      productId: selected.id,
      ...(mode === 'delta' ? { delta: Number(delta) } : { countedQuantity: Number(counted) }),
      reason: reason || undefined,
      ...(note.trim() ? { note } : {}),
    };
    const parsed = movementSchema.safeParse(body);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        // the XOR refinement anchors on `delta`; surface it on the active field
        next[key === 'delta' && mode === 'counted' ? 'countedQuantity' : key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    if (needsWarn && !warnAck) {
      setErrors({ [mode === 'delta' ? 'delta' : 'countedQuantity']: '' });
      return;
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

  return (
    <Modal
      open={open}
      onClose={close}
      title={selected ? `Adjust stock — ${selected.name}` : 'Adjust stock'}
      dismissOnOverlay={false}
    >
      {!selected ? (
        <ProductPicker onSelect={setSelected} />
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-3">
          {formError && (
            <p role="alert" className="text-sm text-danger-600">
              {formError}
            </p>
          )}

          <p className="text-sm text-gray-500">Current quantity: {selected.quantity}</p>

          <div className="flex gap-2" role="radiogroup" aria-label="Adjustment mode">
            {(['delta', 'counted'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => setMode(option)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  mode === option
                    ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                    : 'border-gray-300 text-gray-700'
                }`}
              >
                {option === 'delta' ? '± Change' : 'Counted quantity'}
              </button>
            ))}
          </div>

          {mode === 'delta' ? (
            <FormField label="Adjustment (±)" htmlFor="adjust-delta" error={errors.delta} required>
              <Input
                type="number"
                inputMode="numeric"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                {...fieldAria('adjust-delta', errors.delta)}
              />
            </FormField>
          ) : (
            <FormField
              label="Counted quantity"
              htmlFor="adjust-counted"
              error={errors.countedQuantity}
              required
            >
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                {...fieldAria('adjust-counted', errors.countedQuantity)}
              />
            </FormField>
          )}

          <FormField label="Reason" htmlFor="adjust-reason" error={errors.reason} required>
            <select
              id="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              {...fieldAria('adjust-reason', errors.reason)}
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {ADJUSTMENT_REASONS.map((code) => (
                <option key={code} value={code}>
                  {REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label={reason === 'OTHER' ? 'Note (required)' : 'Note'}
            htmlFor="adjust-note"
            error={errors.note}
            required={reason === 'OTHER'}
          >
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              {...fieldAria('adjust-note', errors.note)}
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
              <span>
                Large adjustment of {changeMagnitude} units — confirm this is intentional.
              </span>
            </label>
          )}

          <SubmitRow onCancel={close} submitLabel="Save adjustment" loading={loading} />
        </form>
      )}
    </Modal>
  );
}
