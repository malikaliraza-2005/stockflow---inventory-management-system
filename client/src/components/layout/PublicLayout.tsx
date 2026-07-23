/** PublicLayout — SMP §1: minimal centered card, no app chrome. */
import { Outlet } from 'react-router-dom';

export function PublicLayout() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-brand-700">StockFlow</h1>
        <Outlet />
      </div>
    </main>
  );
}
