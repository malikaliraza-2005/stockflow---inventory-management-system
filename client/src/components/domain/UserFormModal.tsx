/**
 * UserFormModal — UCA §5.2 (F2). Create OR edit:
 *  - create: name/email/role/temporaryPassword (BR-31 provisioning)
 *  - edit:   name/role/isActive (email immutable; §7.2 PATCH surface)
 *
 * Server-echo mapping (VAL §7): 400 details[] → the matching field; 409
 * DUPLICATE_EMAIL / LAST_ADMIN render inline. Input NEVER discarded (EC-28).
 */
import { useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../../api/client';
import { createUser, updateUser, type Role, type User } from '../../api/users';
import { messageFor } from '../../lib/errorMap';
import { userCreateSchema, userUpdateSchema } from '../../lib/validation/schemas/users';
import { FormField, fieldAria } from '../ui/FormField';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { SubmitRow } from '../ui/SubmitRow';

export interface UserFormModalProps {
  open: boolean;
  /** null = create; a user = edit. */
  editing: User | null;
  onClose: () => void;
  onSaved: () => void;
}

type FieldErrors = Record<string, string>;

const ROLES: Role[] = ['STAFF', 'ADMIN'];

export function UserFormModal({ open, editing, onClose, onSaved }: UserFormModalProps) {
  const isEdit = editing !== null;
  const [name, setName] = useState(editing?.name ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [role, setRole] = useState<Role>(editing?.role ?? 'STAFF');
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  // The modal stays mounted (open toggles), so state initializers don't re-run
  // per open — sync the form to the editing snapshot each time it opens.
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setEmail(editing?.email ?? '');
    setRole(editing?.role ?? 'STAFF');
    setIsActive(editing?.isActive ?? true);
    setTemporaryPassword('');
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
    if (error.code === 'DUPLICATE_EMAIL') {
      setErrors({ email: 'Email already in use' });
      return true;
    }
    return false;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = isEdit
      ? userUpdateSchema.safeParse({ name, role, isActive })
      : userCreateSchema.safeParse({ name, email, role, temporaryPassword });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      if (isEdit) {
        await updateUser(editing.id, { name, role, isActive });
      } else {
        await createUser({ name, email, role, temporaryPassword });
      }
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
      title={isEdit ? 'Edit user' : 'Add user'}
      dismissOnOverlay={false}
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-2">
        {formError && (
          <p role="alert" className="text-sm text-danger-600">
            {formError}
          </p>
        )}
        <FormField label="Name" htmlFor="user-name" error={errors.name} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...fieldAria('user-name', errors.name)}
          />
        </FormField>

        {!isEdit && (
          <FormField label="Email" htmlFor="user-email" error={errors.email} required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              {...fieldAria('user-email', errors.email)}
            />
          </FormField>
        )}

        <FormField label="Role" htmlFor="user-role" error={errors.role} required>
          <select
            id="user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r === 'ADMIN' ? 'Admin' : 'Staff'}
              </option>
            ))}
          </select>
        </FormField>

        {!isEdit && (
          <FormField
            label="Temporary password"
            htmlFor="user-temp-password"
            error={errors.temporaryPassword}
            hint="They'll be required to change it at first sign-in (10–64 chars, a letter and a number)"
            required
          >
            <Input
              type="text"
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              {...fieldAria('user-temp-password', errors.temporaryPassword, 'hint')}
            />
          </FormField>
        )}

        {isEdit && (
          <label className="flex items-center gap-2 py-1 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active account
          </label>
        )}

        <SubmitRow
          onCancel={onClose}
          submitLabel={isEdit ? 'Save changes' : 'Create user'}
          loading={loading}
        />
      </form>
    </Modal>
  );
}
