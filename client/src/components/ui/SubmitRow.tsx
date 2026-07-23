/** SubmitRow — UCA §3.2: cancel left, submit right, everywhere. */
import { Button } from './Button';

export interface SubmitRowProps {
  onCancel?: (() => void) | undefined;
  submitLabel: string;
  loading?: boolean;
  cancelLabel?: string;
}

export function SubmitRow({
  onCancel,
  submitLabel,
  loading = false,
  cancelLabel = 'Cancel',
}: SubmitRowProps) {
  return (
    <div className="flex items-center justify-end gap-3 pt-2">
      {onCancel && (
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
      )}
      <Button type="submit" loading={loading}>
        {submitLabel}
      </Button>
    </div>
  );
}
