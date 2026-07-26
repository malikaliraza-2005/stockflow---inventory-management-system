/**
 * `settings` — DBD §2.7. One document PER TENANT (SaaS): created when a tenant
 * is provisioned (signup/seed). Defaults are COPIED at product creation (DN-3),
 * never referenced — editing settings never rewrites products.
 */
import { model, Schema, type Types } from 'mongoose';

import { tenantScopePlugin } from './plugins/tenantScope.js';

export interface SettingsDoc {
  /** Owning tenant (SaaS). Added by the tenantScope plugin; declared here for types. */
  tenantId: Types.ObjectId;
  currency: string;
  defaultLowStockThreshold: number;
  movementWarningThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export const SETTINGS_DEFAULTS = {
  currency: 'USD',
  defaultLowStockThreshold: 10,
  movementWarningThreshold: 1000,
} as const;

const settingsSchema = new Schema<SettingsDoc>(
  {
    currency: { type: String, required: true, minlength: 3, maxlength: 3 }, // ISO 4217
    defaultLowStockThreshold: { type: Number, required: true, min: 0 },
    movementWarningThreshold: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

settingsSchema.plugin(tenantScopePlugin);

// Exactly one settings document per tenant.
settingsSchema.index({ tenantId: 1 }, { unique: true });

export const Settings = model<SettingsDoc>('Settings', settingsSchema);
