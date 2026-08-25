/** SubmitRow — UCA §3.2: cancel left, submit right, everywhere.
 *
 *  `fullWidth` is the one sanctioned exception: a single-purpose auth form
 *  (login, signup, reset) has exactly one action and the whole column belongs
 *  to it, so the row stacks and the submit spans the form. Dialogs and CRUD
 *  forms keep the standard right-aligned row. */
import { Button } from './Button';

export interface SubmitRowProps {
  onCancel?: (() => void) | undefined;
  submitLabel: string;
  loading?: boolean;
  cancelLabel?: string;
  fullWidth?: boolean;
}

export function SubmitRow({
  onCancel,
  submitLabel,
  loading = false,
  cancelLabel = 'Cancel',
  fullWidth = false,
}: SubmitRowProps) {
  if (fullWidth) {
    return (
      <div className="flex flex-col gap-2 pt-2">
        <Button type="submit" loading={loading} className="w-full py-3 text-sm">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={loading} className="w-full py-3">
            {cancelLabel}
          </Button>
        )}
      </div>
    );
  }

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
