/**
 * Profile page — §9.14 (F2, Any role): own account view + name edit +
 * ChangePasswordForm (UCA §6). Name edit is optimistic-free: PATCH /users/me
 * → refetch. Password change reuses the shared domain form.
 */
import { useCallback, useState, type FormEvent } from 'react';

import { getOwnProfile, updateOwnProfile } from '../../api/users';
import { ChangePasswordForm } from '../../components/domain/ChangePasswordForm';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Badge } from '../../components/ui/Badge';
import { FormField, fieldAria } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { SubmitRow } from '../../components/ui/SubmitRow';
import { useQueryState } from '../../hooks/useQueryState';
import { useToast } from '../../hooks/useToast';
import { meUpdateSchema } from '../../lib/validation/schemas/users';
import { useAuthStore } from '../../stores/authStore';

export default function ProfilePage() {
  const toast = useToast();
  const updateUser = useAuthStore((s) => s.updateUser);
  const { data, loading, error, refetch } = useQueryState(
    useCallback(() => getOwnProfile(), []),
    [],
  );

  if (loading) return <Skeleton variant="card" className="max-w-md" />;
  if (error || !data) {
    return <AlertBanner tone="danger" message="Couldn't load your profile." />;
  }

  return (
    <section className="max-w-md space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-gray-900">Your profile</h1>
        <p className="text-sm text-gray-600">
          {data.email} ·{' '}
          <Badge tone={data.role === 'ADMIN' ? 'success' : 'neutral'}>{data.role}</Badge>
        </p>
      </div>

      <NameSection
        initialName={data.name}
        onSaved={(name) => {
          updateUser({ name }); // keep the AppShell greeting in sync
          toast.success('Name updated.');
          refetch();
        }}
      />

      <div className="space-y-3 border-t border-gray-200 pt-6">
        <h2 className="text-lg font-medium text-gray-900">Change password</h2>
        <ChangePasswordForm onSuccess={() => toast.success('Password changed.')} />
      </div>
    </section>
  );
}

function NameSection({
  initialName,
  onSaved,
}: {
  initialName: string;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = meUpdateSchema.safeParse({ name });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message);
      return;
    }
    setNameError(undefined);
    setSaving(true);
    try {
      await updateOwnProfile(name);
      onSaved(name);
    } catch {
      setNameError('Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-2">
      <FormField label="Name" htmlFor="profile-name" error={nameError} required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...fieldAria('profile-name', nameError)}
        />
      </FormField>
      <SubmitRow submitLabel="Save name" loading={saving} />
    </form>
  );
}
