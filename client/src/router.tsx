/**
 * Route hierarchy — SMP §1, guard nesting per SMP §6:
 *   RequireAuth → ForcePasswordChange gate → AppShell → pages
 *
 * Chunk groups (SMP §7): `auth` is EAGER (entry path, NFR-03); everything
 * else lazy. Guard/lazy ordering rule (SMP review Issue 2): guards wrap lazy
 * route elements, never the reverse — the chunk must not download before the
 * role check. Routes for later-phase pages land with their features; unknown
 * paths hit the ratified 404.
 */
import { createBrowserRouter } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { ErrorFallback } from './components/layout/ErrorFallback';
import { ForcePasswordChangeGate } from './components/layout/ForcePasswordChange';
import { PublicLayout } from './components/layout/PublicLayout';
import { RequireAuth } from './components/layout/RequireAuth';
// Eager auth chunk — smallest first paint (NFR-03)
import LoginPage from './pages/Login';
import ResetPasswordPage from './pages/ResetPassword';

export const router = createBrowserRouter([
  {
    errorElement: <ErrorFallback />, // resets on navigation (ERR Issue 3)
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/reset-password', element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ForcePasswordChangeGate />,
            children: [
              {
                element: <AppShell />,
                children: [
                  {
                    index: true,
                    lazy: async () => ({
                      Component: (await import('./pages/Dashboard')).default,
                    }),
                  },
                  {
                    path: '*',
                    lazy: async () => ({
                      Component: (await import('./pages/NotFound')).default,
                    }),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
