/** MarketingLayout — SMP §8: public marketing chrome (header + footer). The
 *  third layout, alongside PublicLayout (auth card) and AppShell (the app).
 *
 *  The header is fixed and starts transparent so the Landing hero runs edge to
 *  edge behind it (the hero reserves the space with its own top padding); once
 *  the page scrolls past the fold it fades into a frosted white bar with dark
 *  text. Only one route renders inside this layout, so the overlay treatment is
 *  safe to assume — give any future marketing page a dark first section too.
 */
import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';

import { Logo } from '../ui/Logo';

const SECTION_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
];

export function MarketingLayout() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll(); // a reload mid-page must not start transparent
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
          scrolled
            ? 'border-b border-neutral-200 bg-white/85 backdrop-blur-md'
            : 'border-b border-transparent'
        }`}
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <Link to="/" className="rounded-md focus-visible:outline-none">
            <Logo
              wordmarkClassName={`text-xl font-semibold ${scrolled ? 'text-brand-700' : 'text-white'}`}
            />
          </Link>

          <nav className="flex items-center gap-1 md:gap-2">
            {SECTION_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={`hidden rounded-md px-3 py-2 text-sm font-medium transition-colors md:block ${
                  scrolled
                    ? 'text-neutral-600 hover:text-brand-700'
                    : 'text-white/75 hover:text-white'
                }`}
              >
                {l.label}
              </a>
            ))}
            <Link
              to="/login"
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                scrolled
                  ? 'text-neutral-700 hover:text-brand-700'
                  : 'text-white/85 hover:text-white'
              }`}
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 ${
                scrolled
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'bg-white text-brand-800 hover:bg-brand-50'
              }`}
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-neutral-200 bg-neutral-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 md:px-6">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm">
              <Logo />
              <p className="mt-3 text-sm text-neutral-500">
                Inventory management for teams that would rather count once — stock, scanning,
                reports and a complete audit trail.
              </p>
            </div>
            <nav className="flex gap-12 text-sm">
              <div>
                <p className="font-semibold text-neutral-900">Product</p>
                <ul className="mt-3 space-y-2 text-neutral-500">
                  <li>
                    <a href="#features" className="hover:text-brand-700">
                      Features
                    </a>
                  </li>
                  <li>
                    <a href="#how-it-works" className="hover:text-brand-700">
                      How it works
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-neutral-900">Account</p>
                <ul className="mt-3 space-y-2 text-neutral-500">
                  <li>
                    <Link to="/signup" className="hover:text-brand-700">
                      Create workspace
                    </Link>
                  </li>
                  <li>
                    <Link to="/login" className="hover:text-brand-700">
                      Log in
                    </Link>
                  </li>
                </ul>
              </div>
            </nav>
          </div>

          <div className="mt-10 flex items-center gap-2 border-t border-neutral-200 pt-6 text-sm text-neutral-500">
            <Logo showWordmark={false} markClassName="h-5 w-5" />
            <span>© StockFlow — Inventory Management System</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
