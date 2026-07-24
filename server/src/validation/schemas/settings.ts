/**
 * Settings endpoint schema — VAL §3.5 / §5 "Settings" (F11 T-a); DBD §2.7.
 *
 * PUT /settings is a FULL-OBJECT replace (05 §7.10): all three fields required.
 * The stored field is `currency` (the session payload's `systemCurrency` alias
 * is an F1 serialization-boundary rename — NOT this schema's concern).
 *
 * MIRROR: client/src/lib/validation/schemas/settings.ts — ships with the F11
 * frontend task (Settings page).
 */
import { z } from 'zod';

export const settingsMessages = {
  currency: 'Choose a valid currency',
  lowStock: 'Enter a whole number between 0 and 10,000,000',
  warning: 'Enter a whole number between 1 and 100,000',
} as const;

/** ISO 4217 shape: three uppercase letters (trim → uppercase → check). A full
 *  code-list check is out of scope; the 3-letter shape matches the model bound
 *  (DBD §2.7 length 3) and VAL §3.5's "valid ISO 4217 code (3 chars)". */
const currency = z
  .string(settingsMessages.currency)
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{3}$/, settingsMessages.currency));

export const settingsUpdateSchema = z.object({
  currency,
  defaultLowStockThreshold: z
    .number(settingsMessages.lowStock)
    .int(settingsMessages.lowStock)
    .min(0, settingsMessages.lowStock)
    .max(10_000_000, settingsMessages.lowStock),
  movementWarningThreshold: z
    .number(settingsMessages.warning)
    .int(settingsMessages.warning)
    .min(1, settingsMessages.warning)
    .max(100_000, settingsMessages.warning),
});

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
