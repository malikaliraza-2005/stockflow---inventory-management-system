/**
 * `settings` — DBD §2.7, 1:1. Seeded singleton; a missing document is a
 * startup integrity failure (BR-41). Defaults are COPIED at product creation
 * (DN-3), never referenced — editing settings never rewrites products.
 */
import { model, Schema } from 'mongoose';

export interface SettingsDoc {
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

export const Settings = model<SettingsDoc>('Settings', settingsSchema);
