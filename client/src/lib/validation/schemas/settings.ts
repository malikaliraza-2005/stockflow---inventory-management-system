/**
 * Settings schema — VAL §3.5, client mirror (F11 T-a). Mirrors
 * server/src/validation/schemas/settings.ts for the Settings page.
 */
import { z } from 'zod';

export const settingsMessages = {
  currency: 'Choose a valid currency',
  lowStock: 'Enter a whole number between 0 and 10,000,000',
  warning: 'Enter a whole number between 1 and 100,000',
} as const;

const currency = z
  .string(settingsMessages.currency)
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{3}$/, settingsMessages.currency));

export const settingsUpdateSchema = z.object({
  currency,
  defaultLowStockThreshold: z.coerce
    .number(settingsMessages.lowStock)
    .int(settingsMessages.lowStock)
    .min(0, settingsMessages.lowStock)
    .max(10_000_000, settingsMessages.lowStock),
  movementWarningThreshold: z.coerce
    .number(settingsMessages.warning)
    .int(settingsMessages.warning)
    .min(1, settingsMessages.warning)
    .max(100_000, settingsMessages.warning),
});

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
