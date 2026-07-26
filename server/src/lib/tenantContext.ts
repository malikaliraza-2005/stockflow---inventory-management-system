/**
 * Tenant execution context (SaaS multi-tenancy) — the request-scoped source of
 * truth for "which tenant am I acting for right now".
 *
 * Backed by `AsyncLocalStorage`: the `authenticate` middleware opens a tenant
 * store around the downstream handler (derived from the LIVE `req.user.tenantId`
 * — never a client value, never a token claim), and every tenant-scoped model
 * read/write is filtered against `getTenantId()` by the `tenantScope` plugin.
 *
 * Three modes:
 *  - **tenant**  — `runWithTenant(id)`  → all scoped queries filter by `id`.
 *  - **system**  — `runAsSystem()`      → scoping is SUSPENDED. For flows that
 *    legitimately span tenants: login/refresh/signup (resolve a globally-unique
 *    email before any tenant is known), seeds, and per-tenant jobs. In system
 *    mode, writes MUST carry an explicit `tenantId` (the plugin will not invent
 *    one) — this keeps "cross-tenant" an intentional, visible act.
 *  - **none**    — no store on the stack → the plugin FAILS CLOSED (throws)
 *    rather than leak every tenant's data. Establishing a context is mandatory.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Types } from 'mongoose';

export interface TenantStore {
  /** Active tenant, or `null` in system mode. */
  tenantId: Types.ObjectId | null;
  /** True only for `runAsSystem` — suspends automatic tenant scoping. */
  system: boolean;
}

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Run `fn` (and everything it awaits) scoped to a single tenant.
 *
 * The callback is awaited INSIDE the context on purpose: a Mongoose query is
 * lazy (`Model.findX()` builds a query that executes only on `await`), so
 * `runWithTenant(id, () => Model.findOne())` would otherwise return the
 * unexecuted query and run it AFTER the context has unwound. Awaiting here
 * guarantees the query's pre-hooks see the tenant. Always returns a Promise.
 */
export function runWithTenant<T>(tenantId: Types.ObjectId, fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ tenantId, system: false }, async () => {
    // `await` inside the run callback binds the (lazy) query's execution to the
    // context — see the docstring. Do NOT simplify to `() => fn()`.
    const result = await fn();
    return result;
  });
}

/** Run `fn` in system mode — tenant scoping suspended (cross-tenant flows only). */
export function runAsSystem<T>(fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ tenantId: null, system: true }, async () => {
    const result = await fn();
    return result;
  });
}

/** The active store, or `undefined` when no context has been established. */
export function getTenantStore(): TenantStore | undefined {
  return storage.getStore();
}

/** Active tenant id, or `null` in system mode / when no context exists. */
export function getTenantId(): Types.ObjectId | null {
  return storage.getStore()?.tenantId ?? null;
}

/**
 * The active tenant id, or throw. Use in tenant-scoped service code that must
 * name the tenant explicitly (e.g. the native-driver counter key) — it refuses
 * to run in system mode or with no context, so a missing scope is a loud bug.
 */
export function requireTenantId(): Types.ObjectId {
  const store = storage.getStore();
  if (!store || store.system || !store.tenantId) {
    throw new Error('requireTenantId(): no tenant context is established (fail-closed).');
  }
  return store.tenantId;
}

/**
 * Bind a tenant context to the CURRENT async execution WITHOUT a wrapping
 * callback (`AsyncLocalStorage.enterWith`). App code must always prefer
 * `runWithTenant` — this exists ONLY for test harnesses that establish context
 * from a `beforeEach` hook, which cannot wrap the test body in a callback.
 */
export function enterTenantContextForTesting(tenantId: Types.ObjectId): void {
  storage.enterWith({ tenantId, system: false });
}

/** Test seam: bind system context to the current async execution (see above). */
export function enterSystemContextForTesting(): void {
  storage.enterWith({ tenantId: null, system: true });
}
