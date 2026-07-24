/**
 * Settings page — WIR §14 / FR-SET (F11, Admin). Currency + the two thresholds.
 * A saved change is audited (server) and re-hydrates the settingsStore so money
 * formatting updates app-wide. defaultLowStockThreshold reaches NEW products
 * only (DN-3) — existing products keep their copied value.
 */
import { useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../../api/client';
import { getSettings, updateSettings } from '../../api/settings';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { FormField, fieldAria } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { SubmitRow } from '../../components/ui/SubmitRow';
import { useQueryState } from '../../hooks/useQueryState';
import { useToast } from '../../hooks/useToast';
import { messageFor } from '../../lib/errorMap';
import { settingsUpdateSchema } from '../../lib/validation/schemas/settings';
import { useSettingsStore } from '../../stores/settingsStore';

// A curated ISO 4217 shortlist for the select (VAL validates the 3-letter shape).
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'PKR', 'CNY', 'AED', 'SAR'];

type FieldErrors = Record<string, string>;

export default function SettingsPage() {
  const toast = useToast();
  const setStore = useSettingsStore((s) => s.setSettings);
  const { data, loading, error, refetch } = useQueryState(() => getSettings(), []);

  const [currency, setCurrency] = useState('USD');
  const [lowStock, setLowStock] = useState('');
  const [warning, setWarning] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setCurrency(data.currency);
    setLowStock(String(data.defaultLowStockThreshold));
    setWarning(String(data.movementWarningThreshold));
  }, [data]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = settingsUpdateSchema.safeParse({
      currency,
      defaultLowStockThreshold: lowStock,
      movementWarningThreshold: warning,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      const saved = await updateSettings(parsed.data);
      setStore({
        currency: saved.currency,
        defaultLowStockThreshold: saved.defaultLowStockThreshold,
        movementWarningThreshold: saved.movementWarningThreshold,
      });
      toast.success('Settings saved.');
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'VALIDATION_ERROR' &&
        Array.isArray(err.details)
      ) {
        const next: FieldErrors = {};
        for (const item of err.details as { field: string; message: string }[]) {
          next[item.field] ??= item.message;
        }
        setErrors(next);
      } else {
        setFormError(err instanceof ApiError ? messageFor(err.code) : messageFor('INTERNAL_ERROR'));
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error || !data) {
    return (
      <AlertBanner
        tone="danger"
        message="Couldn't load settings."
        action={
          <Button variant="secondary" onClick={refetch}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <section className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">System settings</h1>
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-2">
        {formError && (
          <p role="alert" className="text-sm text-danger-600">
            {formError}
          </p>
        )}
        <FormField label="Currency" htmlFor="s-currency" error={errors.currency} required>
          <select
            id="s-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Default low-stock threshold"
          htmlFor="s-lowstock"
          error={errors.defaultLowStockThreshold}
          hint="Copied into new products; existing products are unchanged (DN-3)"
          required
        >
          <Input
            value={lowStock}
            onChange={(e) => setLowStock(e.target.value)}
            inputMode="numeric"
            {...fieldAria('s-lowstock', errors.defaultLowStockThreshold, 'hint')}
          />
        </FormField>

        <FormField
          label="Movement warning threshold"
          htmlFor="s-warning"
          error={errors.movementWarningThreshold}
          required
        >
          <Input
            value={warning}
            onChange={(e) => setWarning(e.target.value)}
            inputMode="numeric"
            {...fieldAria('s-warning', errors.movementWarningThreshold)}
          />
        </FormField>

        <p className="text-xs text-gray-500">Changes are recorded in the audit log.</p>
        <SubmitRow submitLabel="Save changes" loading={saving} />
      </form>
    </section>
  );
}
