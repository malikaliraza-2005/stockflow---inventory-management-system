/**
 * App root — F1: session bootstrap (A-7 refresh-on-load), the router with the
 * guard spine, and the global feedback chrome (ToastRegion). `endSession`
 * navigation is registered here — the api layer stays router-blind (SMA §7).
 */
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';

import { bootstrapSession } from './api/auth';
import { registerSessionEndNavigator } from './api/session';
import { ToastRegion } from './components/ui/ToastRegion';
import { router } from './router';

registerSessionEndNavigator(() => {
  // Reason-appropriate notices are pushed by the endSession callers; the hop
  // itself is uniform (SMA §7 step 4).
  void router.navigate('/login', { replace: true });
});

export default function App() {
  useEffect(() => {
    // A-7: hydrate the session from the httpOnly cookie exactly once.
    void bootstrapSession();
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      <ToastRegion />
    </>
  );
}
