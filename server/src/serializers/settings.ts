/**
 * Settings serialization — the wire contract slice for F11 (05 §7.10 / DBD §2.7).
 *
 * Emits the stored field names (`currency`, not the session DTO's
 * `systemCurrency` alias). Dates → ISO-8601 UTC.
 */
import type { HydratedDocument } from 'mongoose';

import type { SettingsDoc } from '../models/Settings.js';

export interface SettingsPayload {
  currency: string;
  defaultLowStockThreshold: number;
  movementWarningThreshold: number;
  updatedAt: string;
}

export function serializeSettings(settings: HydratedDocument<SettingsDoc>): SettingsPayload {
  return {
    currency: settings.currency,
    defaultLowStockThreshold: settings.defaultLowStockThreshold,
    movementWarningThreshold: settings.movementWarningThreshold,
    updatedAt: settings.updatedAt.toISOString(),
  };
}
