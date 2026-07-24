/**
 * CategoryFormModal — UCA §5 (F3). Create OR edit: name + description.
 *
 * Server-echo mapping (VAL §7): 400 details[] → the matching field. A duplicate
 * name arrives as VALIDATION_ERROR on `name` (APR-08 — not a 409), so it renders
 * inline like any field error. Input is NEVER discarded (EC-28).
 */
import { useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../../api/client';
import { createCategory, updateCategory, type Category } from '../../api/categories';
import { messageFor } from '../../lib/errorMap';
import { categoryWriteSchema } from '../../lib/validation/schemas/categories';
import { FormField, fieldAria } from '../ui/FormField';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { SubmitRow } from '../ui/SubmitRow';

export interface CategoryFormModalProps {
  open: boolean;
  /** null = create; a category = edit. */
  editing: Category | null;
  onClose: () => void;
  onSaved: () => void;
}

type FieldErrors = Record<string, string>;

export function CategoryFormModal({ open, editing, onClose, onSaved }: CategoryFormModalProps) {
  const isEdit = editing !== null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setErrors({});
    setFormError(undefined);
  }, [open, editing]);

  function applyDetails(error: ApiError): boolean {
    if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
      const next: FieldErrors = {};
      for (const item of error.details as { field: string; message: string }[]) {
        next[item.field] ??= item.message;
      }
      setErrors(next);
      return true;
    }
    return false;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = categoryWriteSchema.safeParse({ name, description });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      const body = { name, ...(description.trim() ? { description } : {}) };
      if (isEdit) await updateCategory(editing.id, body);
      else await createCategory(body);
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && !applyDetails(error)) {
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
      onClose={onClose}
      title={isEdit ? 'Edit category' : 'Add category'}
      dismissOnOverlay={false}
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-2">
        {formError && (
          <p role="alert" className="text-sm text-danger-600">
            {formError}
          </p>
        )}
        <FormField label="Name" htmlFor="category-name" error={errors.name} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...fieldAria('category-name', errors.name)}
          />
        </FormField>

        <FormField label="Description" htmlFor="category-description" error={errors.description}>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            {...fieldAria('category-description', errors.description)}
          />
        </FormField>

        <SubmitRow onCancel={onClose} submitLabel="Save" loading={loading} />
      </form>
    </Modal>
  );
}
