/**
 * AppShell — SMP §8 / UCA §2: Sidebar + TopBar + <Outlet/>. Navigation
 * derives from the sitemap; admin entries render only when `usePermission`
 * grants them (FD-3 — courtesy visibility, server enforces). Routes whose
 * pages arrive in later phases are listed here from the start so the shell
 * is the real one — their targets 404 into the ratified NotFound page until
 * their feature ships.
 */
import { NavLink, Outlet } from 'react-router-dom';

import { logout } from '../../api/auth';
import { usePermission } from '../../hooks/usePermission';
import { selectSidebarCollapsed, useUiStore } from '../../stores/uiStore';
import { selectUser, useAuthStore } from '../../stores/authStore';
import type { Capability } from '../../lib/permissions.generated';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { NAV_ICONS } from './navIcons';

interface NavEntry {
  to: string;
  label: string;
  capability: Capability;
}

/** SMP §3 navigation model — capability keys gate visibility (FD-3). */
const NAV_ENTRIES: NavEntry[] = [
  { to: '/dashboard', label: 'Dashboard', capability: 'dashboard.view' },
  { to: '/products', label: 'Products', capability: 'products.view' },
  { to: '/scanner', label: 'Scanner', capability: 'movements.stockInOut' },
  { to: '/categories', label: 'Categories', capability: 'categories.view' },
  { to: '/transactions', label: 'Transactions', capability: 'transactions.view' },
  { to: '/reports', label: 'Reports', capability: 'reports.view' },
  { to: '/users', label: 'Users', capability: 'users.manage' },
  { to: '/settings', label: 'Settings', capability: 'settings.manage' },
];

export function AppShell() {
  const user = useAuthStore(selectUser);
  const collapsed = useUiStore(selectSidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const can = usePermission();
  const initials =
    (user?.name ?? '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside
        className={`hidden shrink-0 border-r border-neutral-200 bg-white md:block ${collapsed ? 'w-14' : 'w-56'}`}
        aria-label="Primary navigation"
      >
        <div className="flex h-14 items-center justify-between px-4">
          {!collapsed && (
            <Logo markClassName="h-6 w-6" wordmarkClassName="font-semibold text-brand-700" />
          )}
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleSidebar}
            className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100"
          >
            ☰
          </button>
        </div>
        <nav className="space-y-1 px-2 py-2">
          {NAV_ENTRIES.filter((entry) => can(entry.capability)).map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              end={entry.to === '/dashboard'}
              title={entry.label}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  collapsed ? 'justify-center' : ''
                } ${
                  isActive
                    ? 'bg-brand-600 font-medium text-white shadow-sm'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`
              }
            >
              <span className="shrink-0">{NAV_ICONS[entry.to]}</span>
              {!collapsed && <span className="truncate">{entry.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-200 bg-white/90 px-4 backdrop-blur">
          <Logo
            className="md:hidden"
            markClassName="h-6 w-6"
            wordmarkClassName="font-semibold text-brand-700"
          />
          <div className="ml-auto flex items-center gap-2">
            <NavLink
              to="/profile"
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                {initials}
              </span>
              <span className="hidden sm:inline">{user?.name}</span>
            </NavLink>
            <Button variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 pb-24 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation — the sidebar's entries as a tab bar (< md).
          Scrolls horizontally when a role sees more tabs than fit the width. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgba(0,0,0,0.06)] backdrop-blur md:hidden"
      >
        {NAV_ENTRIES.filter((entry) => can(entry.capability)).map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.to === '/dashboard'}
            className={({ isActive }) =>
              `flex w-18 shrink-0 flex-col items-center gap-1 px-1 py-2 text-[10px] transition-colors ${
                isActive ? 'font-medium text-brand-700' : 'text-neutral-500'
              }`
            }
          >
            <span className="shrink-0">{NAV_ICONS[entry.to]}</span>
            <span className="w-full truncate text-center leading-tight">{entry.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
