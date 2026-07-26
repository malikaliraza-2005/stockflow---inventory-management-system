/**
 * Route-level error fallback — ERR §5.2: message + [Retry], never a blank
 * screen. Used as react-router `errorElement`, which resets on navigation by
 * construction (ERR review Issue 3).
 */
import { useNavigate, useRouteError } from 'react-router-dom';

import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';

export function ErrorFallback() {
  const navigate = useNavigate();
  useRouteError(); // detail stays out of the UI (SEC-12); boundary logs suffice

  return (
    <main
      className="mx-auto mt-16 flex max-w-md flex-col items-center space-y-4 px-4 text-center"
      data-testid="route-error"
    >
      <Logo showWordmark={false} markClassName="h-12 w-12" />
      <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
      <p className="text-sm text-gray-600">The view crashed. Your data is unaffected.</p>
      <Button onClick={() => navigate(0)}>Retry</Button>
    </main>
  );
}
