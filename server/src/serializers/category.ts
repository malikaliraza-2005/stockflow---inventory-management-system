/**
 * Category serialization — the wire contract slice for F3 (05 §7.4 / DBD §7).
 *
 * Built field-by-field (never spread from the doc): `_id` → `id` string; the
 * optional `description` follows the 05 §2 sparse rule (absent, never null);
 * `productCount` is present ONLY on `?withCounts=true` responses (§9.9).
 */
import type { HydratedDocument } from 'mongoose';

import type { CategoryDoc } from '../models/Category.js';

/** The 05 §7.4 category row (list + detail). */
export interface CategoryPayload {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  productCount?: number;
}

export function serializeCategory(
  category: HydratedDocument<CategoryDoc>,
  productCount?: number,
): CategoryPayload {
  return {
    id: category._id.toString(),
    name: category.name,
    ...(category.description ? { description: category.description } : {}),
    isSystem: category.isSystem,
    // withCounts only — a resolved count of 0 is still meaningful and included
    ...(productCount !== undefined ? { productCount } : {}),
  };
}
