/** MarketingLayout — SMP §8: public marketing chrome (header + footer). The
 *  third layout, alongside PublicLayout (auth card) and AppShell (the app). */
import { Link, Outlet } from 'react-router-dom';

import { Logo } from '../ui/Logo';

export function MarketingLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <Link to="/" className="rounded-md focus-visible:outline-none">
            <Logo />
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-neutral-700 hover:text-brand-700">
              Log in
            </Link>
            <Link
              to="/signup"
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-8 text-sm text-neutral-500 md:px-6">
          <Logo showWordmark={false} markClassName="h-5 w-5" />
          <span>© StockFlow — Inventory Management System</span>
        </div>
      </footer>
    </div>
  );
}
