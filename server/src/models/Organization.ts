/**
 * `organizations` — the tenant registry (SaaS multi-tenancy). One document per
 * customer workspace; every tenant-owned record carries this `_id` as its
 * `tenantId`. Born at public signup (org + first Admin, atomically), never via
 * the Admin user-provisioning path.
 *
 * This collection is itself NOT tenant-scoped (it IS the set of tenants), so it
 * does not carry the `tenantScope` plugin. It is read in system context during
 * auth/signup and by tenant-iterating jobs.
 */
import { model, Schema, type Types } from 'mongoose';

export const ORG_PLANS = ['FREE'] as const;
export type OrgPlan = (typeof ORG_PLANS)[number];

export const ORG_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export interface OrganizationDoc {
  name: string;
  /** URL-safe unique handle derived from `name` at signup (display / future subdomains). */
  slug: string;
  /** The first Admin created alongside this org (the tenant owner). */
  ownerUserId: Types.ObjectId;
  plan: OrgPlan;
  status: OrgStatus;
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<OrganizationDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 2,
      maxlength: 140,
    },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: String, required: true, enum: ORG_PLANS, default: 'FREE' },
    status: { type: String, required: true, enum: ORG_STATUSES, default: 'ACTIVE' },
  },
  { timestamps: true },
);

organizationSchema.index({ slug: 1 }, { unique: true });

export const Organization = model<OrganizationDoc>('Organization', organizationSchema);
