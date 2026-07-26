/**
 * `tenantScope` — the multi-tenancy isolation invariant, expressed once as a
 * Mongoose plugin and applied to every tenant-owned model (users, products,
 * categories, transactions, auditLogs, settings).
 *
 * It does three things:
 *   1. Adds a required, indexed `tenantId` path to the schema.
 *   2. On every query (find/update/delete/count/distinct) injects
 *      `{ tenantId }` from the active tenant context — so a cross-tenant `_id`
 *      simply misses (IDOR-safe) and lists never span tenants.
 *   3. On every insert (save / insertMany) and aggregation, stamps / `$match`es
 *      the active tenant.
 *
 * **Fail closed:** with NO tenant context established, scoped operations throw
 * rather than run unscoped — defense-in-depth so a forgotten `runWithTenant`
 * is a loud 500, never a silent cross-tenant leak. `runAsSystem` suspends the
 * automatic scoping for legitimate cross-tenant flows (auth, seeds, jobs); in
 * that mode inserts must supply their own `tenantId`.
 *
 * NOT applied to: `Organization` (it IS the tenant), `refreshTokens` (resolved
 * by opaque hash before any context exists), `counters` (native-driver, keyed
 * by a tenant-composite `_id`), and `jobLocks` (global infra).
 *
 * The 3 native-driver call sites (counters, the last-admin `appguards` guard,
 * CategoryService's direct `products` access) bypass Mongoose middleware and
 * are scoped by hand at their call sites — see those services.
 */
import { Schema, type Aggregate, type Document, type Query } from 'mongoose';

import { getTenantStore } from '../../lib/tenantContext.js';

const TENANT_FIELD = 'tenantId';

/** Query middleware whose filter must be tenant-scoped. */
const SCOPED_QUERY_HOOKS = [
  'count',
  'countDocuments',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
] as const;

/**
 * A missing tenant context on a scoped operation is a server-side programming
 * error (someone forgot to open a context), NOT a client fault — it surfaces as
 * a 500 through the error handler, which is the correct fail-closed outcome.
 */
export class MissingTenantContextError extends Error {
  constructor(operation: string) {
    super(`Tenant context required for "${operation}" but none was established (fail-closed).`);
    this.name = 'MissingTenantContextError';
  }
}

export function tenantScopePlugin(schema: Schema): void {
  // The path only — each model declares its own tenant-LEADING index (compound
  // or unique) so every scoped query is index-served and there is no redundant
  // standalone `{ tenantId }` index competing with those.
  schema.add({
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
  });

  // Reads / updates / deletes — inject the tenant into the query filter.
  const scopeQuery = function (this: Query<unknown, unknown>): void {
    const store = getTenantStore();
    if (store?.system) return; // system mode: caller is responsible for scope
    const tenantId = store?.tenantId;
    if (!tenantId) {
      throw new MissingTenantContextError((this as { op?: string }).op ?? 'query');
    }

    const filter = this.getQuery() as Record<string, unknown>;
    if (filter[TENANT_FIELD] === undefined) filter[TENANT_FIELD] = tenantId;
  };
  // Cast: `pre` has no overload for a runtime-iterated hook-name union, but it
  // accepts every one of these names individually at runtime.
  const registerPre = schema.pre.bind(schema) as (hook: string, fn: () => void) => void;
  for (const hook of SCOPED_QUERY_HOOKS) registerPre(hook, scopeQuery);

  // Inserts via document.save() — stamp the tenant onto new documents. Uses
  // pre('validate') (not 'save') because Mongoose runs its own validation as a
  // pre-save hook registered BEFORE this plugin's, so a 'save' hook would set
  // tenantId too late and validation would reject the required field.
  schema.pre('validate', function (this: Document) {
    if (!this.isNew) return;
    const doc = this as unknown as Record<string, unknown>;
    const store = getTenantStore();
    if (store?.system) {
      // System writes must be explicit about their tenant (or tenant-less setup).
      if (doc[TENANT_FIELD] == null) {
        throw new MissingTenantContextError('save (system mode requires an explicit tenantId)');
      }
      return;
    }
    const tenantId = store?.tenantId;
    if (!tenantId) throw new MissingTenantContextError('save');
    if (doc[TENANT_FIELD] == null) doc[TENANT_FIELD] = tenantId;
  });

  // Inserts via Model.insertMany() — stamp each document.
  schema.pre(
    'insertMany',
    function (next: (err?: Error) => void, docs: Array<Record<string, unknown>>) {
      const store = getTenantStore();
      if (store?.system) {
        next();
        return;
      }
      const tenantId = store?.tenantId;
      if (!tenantId) {
        next(new MissingTenantContextError('insertMany'));
        return;
      }
      for (const doc of docs) {
        if (doc[TENANT_FIELD] == null) doc[TENANT_FIELD] = tenantId;
      }
      next();
    },
  );

  // Aggregations — tenant `$match` as the first pipeline stage (index-friendly).
  schema.pre('aggregate', function (this: Aggregate<unknown[]>) {
    const store = getTenantStore();
    if (store?.system) return;
    const tenantId = store?.tenantId;
    if (!tenantId) throw new MissingTenantContextError('aggregate');
    this.pipeline().unshift({ $match: { [TENANT_FIELD]: tenantId } });
  });
}
