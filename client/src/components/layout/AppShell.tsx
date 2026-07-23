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

interface NavEntry {
  to: string;
  label: string;
  capability: Capability;
}

/** SMP §3 navigation model — capability keys gate visibility (FD-3). */
const NAV_ENTRIES: NavEntry[] = [
  { to: '/', label: 'Dashboard', capability: 'dashboard.view' },
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

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside
        className={`hidden shrink-0 border-r border-gray-200 bg-white md:block ${collapsed ? 'w-14' : 'w-56'}`}
        aria-label="Primary navigation"
      >
        <div className="flex h-14 items-center justify-between px-4">
          {!collapsed && <span className="font-semibold text-brand-700">StockFlow</span>}
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleSidebar}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            ☰
          </button>
        </div>
        <nav className="space-y-1 px-2 py-2">
          {NAV_ENTRIES.filter((entry) => can(entry.capability)).map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              end={entry.to === '/'}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              {collapsed ? entry.label.slice(0, 1) : entry.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
          <span className="font-semibold text-brand-700 md:hidden">StockFlow</span>
          <div className="ml-auto flex items-center gap-3">
            <NavLink to="/profile" className="text-sm text-gray-700 hover:underline">
              {user?.name}
            </NavLink>
            <Button variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
