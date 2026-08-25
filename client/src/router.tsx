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
import { MarketingLayout } from './components/layout/MarketingLayout';
import { RequireAnon } from './components/layout/RequireAnon';
import { RequireAuth } from './components/layout/RequireAuth';
import { RequireRole } from './components/layout/RequireRole';
// Eager auth chunk — smallest first paint (NFR-03)
import Landing from './pages/Landing';
import LoginPage from './pages/Login';
import ResetPasswordPage from './pages/ResetPassword';
import SignupPage from './pages/Signup';

export const router = createBrowserRouter([
  {
    errorElement: <ErrorFallback />, // resets on navigation (ERR Issue 3)
    children: [
      {
        element: <RequireAnon />,
        children: [
          {
            element: <MarketingLayout />,
            children: [{ index: true, element: <Landing /> }],
          },
        ],
      },
      {
        element: <PublicLayout />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/signup', element: <SignupPage /> },
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
                    path: 'dashboard',
                    lazy: async () => ({
                      Component: (await import('./pages/Dashboard')).default,
                    }),
                  },
                  {
                    // core chunk — Any role
                    path: 'profile',
                    lazy: async () => ({
                      Component: (await import('./pages/Profile')).default,
                    }),
                  },
                  {
                    // Categories — Any role views; writes gated in-page (FR-CAT-03)
                    path: 'categories',
                    lazy: async () => ({
                      Component: (await import('./pages/Categories')).default,
                    }),
                  },
                  {
                    // Products list + detail — Any role views (writes gated in-page)
                    path: 'products',
                    lazy: async () => ({
                      Component: (await import('./pages/Products')).default,
                    }),
                  },
                  {
                    path: 'products/:id',
                    lazy: async () => ({
                      Component: (await import('./pages/ProductDetail')).default,
                    }),
                  },
                  {
                    // Scanner — Any role (F8). ZXing rides its own lazy chunk
                    // inside ScannerViewport; the Adjust action is gated in-page
                    // (movements.adjust), so no RequireRole wrapper here.
                    path: 'scanner',
                    lazy: async () => ({
                      Component: (await import('./pages/Scanner')).default,
                    }),
                  },
                  {
                    // Stock Ledger — Any role reads (F7); the Audit tab (Phase 5)
                    // is gated in-page (usePermission), not by a separate route.
                    path: 'transactions',
                    lazy: async () => ({
                      Component: (await import('./pages/Transactions')).default,
                    }),
                  },
                  {
                    // AI inventory assistant — Any role (chat.use). The route
                    // stays registered even when CHAT_ENABLED is off: the page
                    // itself checks the session's chatEnabled flag, so toggling
                    // the server needs no client deploy.
                    path: 'assistant',
                    lazy: async () => ({
                      Component: (await import('./pages/Assistant')).default,
                    }),
                  },
                  {
                    // Reports — Any role views (F10); export + consistency gated
                    // in-page (reports.export / reports.consistency).
                    path: 'reports',
                    lazy: async () => ({
                      Component: (await import('./pages/Reports')).default,
                    }),
                  },
                  {
                    // admin chunk — guard OUTSIDE lazy (SMP Issue 2: the chunk
                    // must not download before the role check)
                    element: <RequireRole role="ADMIN" />,
                    children: [
                      {
                        path: 'users',
                        lazy: async () => ({
                          Component: (await import('./pages/Users')).default,
                        }),
                      },
                      {
                        // Admin catalog-write routes — guard OUTSIDE lazy (SMP Issue 2)
                        path: 'products/new',
                        lazy: async () => ({
                          Component: (await import('./pages/AddProduct')).default,
                        }),
                      },
                      {
                        path: 'products/:id/edit',
                        lazy: async () => ({
                          Component: (await import('./pages/EditProduct')).default,
                        }),
                      },
                      {
                        path: 'settings',
                        lazy: async () => ({
                          Component: (await import('./pages/Settings')).default,
                        }),
                      },
                    ],
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
