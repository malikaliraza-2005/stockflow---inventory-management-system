/**
 * Tenant provisioning (SaaS) — the runtime analog of the single-org seed.
 * Creates a tenant and its first-run data in ONE unit: the `organization`, its
 * first Admin (the owner), the per-tenant `settings` document, and the system
 * `Uncategorized` category (BR-28). Shared by public signup (auth) and the dev
 * seed so "a new workspace" is defined in exactly one place.
 *
 * Tenant-owned rows (user/settings/category) are stamped by the tenantScope
 * plugin via `runWithTenant`; the `organization` row (untenanted registry) is
 * written directly. The caller owns the transaction and passes its session so
 * every row commits or aborts together.
 */
import mongoose, { type ClientSession, type Types } from 'mongoose';

import { runWithTenant } from '../lib/tenantContext.js';
import { Category } from '../models/Category.js';
import { Organization } from '../models/Organization.js';
import { Settings, SETTINGS_DEFAULTS } from '../models/Settings.js';
import { User, type AuthProvider } from '../models/User.js';

/** The permanent system category every tenant is born with (BR-28). */
export const UNCATEGORIZED_NAME = 'Uncategorized';

export interface ProvisionTenantInput {
  organizationName: string;
  /** URL-safe unique handle (caller ensures uniqueness; the index is the backstop). */
  slug: string;
  adminName: string;
  adminEmail: string;
  /** Pre-hashed (the caller owns bcrypt cost). Omitted for a Google-only owner. */
  adminPasswordHash?: string;
  /** LOCAL (default) or GOOGLE for a password-less Google signup. */
  authProvider?: AuthProvider;
  /** Google `sub` — set when provisioning via Google sign-in. */
  googleSub?: string;
  /** First Admin's forced-change flag — false for self-signup, true for a seeded demo. */
  mustChangePassword?: boolean;
}

export interface ProvisionedTenant {
  orgId: Types.ObjectId;
  userId: Types.ObjectId;
}

export async function provisionTenant(
  input: ProvisionTenantInput,
  options: { session: ClientSession },
): Promise<ProvisionedTenant> {
  const { session } = options;
  // Pre-generate the cross-referenced ids (org.ownerUserId ↔ user.tenantId).
  const orgId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  await runWithTenant(orgId, async () => {
    await User.create(
      [
        {
          _id: userId,
          tenantId: orgId,
          name: input.adminName,
          email: input.adminEmail,
          ...(input.adminPasswordHash ? { passwordHash: input.adminPasswordHash } : {}),
          authProvider: input.authProvider ?? 'LOCAL',
          ...(input.googleSub ? { googleSub: input.googleSub } : {}),
          role: 'ADMIN',
          isActive: true,
          mustChangePassword: input.mustChangePassword ?? false,
          failedLoginCount: 0,
        },
      ],
      { session },
    );
    await Settings.create([{ tenantId: orgId, ...SETTINGS_DEFAULTS }], { session });
    await Category.create([{ tenantId: orgId, name: UNCATEGORIZED_NAME, isSystem: true }], {
      session,
    });
  });

  await Organization.create(
    [
      {
        _id: orgId,
        name: input.organizationName,
        slug: input.slug,
        ownerUserId: userId,
        plan: 'FREE',
        status: 'ACTIVE',
      },
    ],
    { session },
  );

  return { orgId, userId };
}
