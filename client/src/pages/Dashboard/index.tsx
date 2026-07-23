/**
 * Dashboard route target — the F9 dashboard (KPIs, alerts, charts) arrives in
 * Phase 5. This placeholder exists because "/" is the post-login landing and
 * the guard spine needs its real route today; it renders inside the full
 * AppShell so Phase-1 staging verification exercises the genuine shell.
 */
import { selectUser, useAuthStore } from '../../stores/authStore';

export default function DashboardPage() {
  const user = useAuthStore(selectUser);
  return (
    <section className="space-y-2">
      <h1 className="text-xl font-semibold text-gray-900">Welcome, {user?.name}</h1>
      <p className="text-sm text-gray-600">
        The dashboard (KPIs, stock alerts, activity) arrives with Phase 5. Navigation on the left
        fills in feature by feature.
      </p>
    </section>
  );
}
