/**
 * ManualCodeEntry — UCA §5.2 / FR-SCAN-01. The universal fallback, rendered in
 * EVERY scanner state (the page keeps it mounted regardless of camera phase):
 * the system is fully operable with zero working cameras, and this is the path
 * the E2E scan flow tests (TST Issue 1 — zero camera mocks).
 *
 * Guards the payload BEFORE lookup (BR-16 / EC-20): a malformed code renders the
 * inline `INVALID_BARCODE` message and never reaches the network. Submits the
 * trimmed code via `onSubmit`; the page owns the lookup and result rendering.
 */
import { useState, type FormEvent } from 'react';

import { parseScanCode } from '../../lib/validation/schemas/scanner';
import { messageFor } from '../../lib/errorMap';
import { Button } from '../ui/Button';
import { FormField, fieldAria } from '../ui/FormField';
import { Input } from '../ui/Input';

export interface ManualCodeEntryProps {
  onSubmit: (code: string) => void;
  /** Disabled while a lookup is already in flight. */
  disabled?: boolean;
}

const INPUT_ID = 'manual-code';

export function ManualCodeEntry({ onSubmit, disabled = false }: ManualCodeEntryProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseScanCode(value);
    if (!parsed.ok || parsed.code === undefined) {
      setError(messageFor('INVALID_BARCODE')); // "Code can't be read."
      return;
    }
    setError(undefined);
    onSubmit(parsed.code);
    setValue('');
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <FormField label="Enter a code" htmlFor={INPUT_ID} error={error}>
          <Input
            {...fieldAria(INPUT_ID, error)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Barcode or SKU"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={64}
          />
        </FormField>
      </div>
      <div className="pt-6">
        <Button type="submit" variant="primary" disabled={disabled}>
          Look up
        </Button>
      </div>
    </form>
  );
}
