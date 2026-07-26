/**
 * Test tenant harness (SaaS). Unit suites call services/models directly, so —
 * like a real request — they need a tenant context established. The tenantScope
 * plugin fails closed without one.
 *
 * `useTestTenant()` registers a `beforeEach` that binds a fixed tenant to the
 * current async execution (via the enterWith test seam), so all model reads /
 * writes in that suite's hooks AND test bodies are scoped to `TEST_TENANT_ID`.
 * Call it once near the top of a unit suite that touches tenant-owned models.
 */
import { Types } from 'mongoose';
import { beforeEach } from 'vitest';

import {
  enterSystemContextForTesting,
  enterTenantContextForTesting,
} from '../../src/lib/tenantContext.js';

/** A stable tenant id every single-tenant unit suite runs inside (24-hex). */
export const TEST_TENANT_ID = new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaa1');
/** A second tenant for isolation assertions (24-hex). */
export const OTHER_TENANT_ID = new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbb2');

/** Register a beforeEach that runs every test in this suite as TEST_TENANT_ID. */
export function useTestTenant(tenantId: Types.ObjectId = TEST_TENANT_ID): void {
  beforeEach(() => {
    enterTenantContextForTesting(tenantId);
  });
}

/** Re-exported for suites that need to switch context mid-test. */
export { enterTenantContextForTesting, enterSystemContextForTesting };
