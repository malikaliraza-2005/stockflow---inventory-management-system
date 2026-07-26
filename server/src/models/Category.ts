/**
 * `categories` — DBD §2.2, 1:1. Flat taxonomy including the permanent system
 * member Uncategorized (`isSystem: true`, undeletable — BR-28).
 *
 * COLLATION RULE (DBD §2.2): the unique name index uses `{locale:'en',
 * strength:2}` (case-insensitive). Every query matching on `name` MUST pass
 * the same collation or the index is bypassed for matching — CategoryService
 * (F3) is the single home of name queries; the seed honors it below.
 */
import { model, Schema, type Types } from 'mongoose';

import { tenantScopePlugin } from './plugins/tenantScope.js';

export const CATEGORY_NAME_COLLATION = { locale: 'en', strength: 2 } as const;

export interface CategoryDoc {
  /** Owning tenant (SaaS). Added by the tenantScope plugin; declared here for types. */
  tenantId: Types.ObjectId;
  name: string;
  description?: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    description: { type: String, maxlength: 300 },
    isSystem: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

categorySchema.plugin(tenantScopePlugin);

// Name uniqueness is PER-TENANT under the §2.2 collation (case-insensitive).
categorySchema.index(
  { tenantId: 1, name: 1 },
  { unique: true, collation: CATEGORY_NAME_COLLATION },
);

export const Category = model<CategoryDoc>('Category', categorySchema);
