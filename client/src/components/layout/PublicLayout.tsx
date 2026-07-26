/** PublicLayout — SMP §1: minimal centered card, no app chrome. */
import { Outlet } from 'react-router-dom';

import { Logo } from '../ui/Logo';

export function PublicLayout() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Outlet />
      </div>
    </main>
  );
}
