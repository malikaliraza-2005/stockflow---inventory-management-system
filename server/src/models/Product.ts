/**
 * `products` — DBD §2.3, catalog + materialized stock. The heart of F4.
 *
 * Money is stored as **Decimal128** (exact 2-dp arithmetic — never float); the
 * serializer renders it back to the 2-dp API string (DBR-05). `quantity` has a
 * SINGLE writer — MovementService (DN-1); no catalog write path ever touches
 * it (BR-17), which is why POST/PATCH schemas exclude it.
 *
 * `version` is an EXPLICIT optimistic-concurrency counter (BR-24): incremented
 * on catalog writes only, checked as a PATCH precondition (→ STALE_WRITE).
 * Mongoose's own `__v` is disabled (`versionKey: false`) so the two never
 * compete — movements must be able to update the doc without bumping it.
 *
 * `images` obeys DBR-03/BR-36 — exactly one primary when the array is
 * non-empty — a NAMED service-enforced invariant (ProductService), not
 * expressible in a JSON-schema validator.
 */
import { model, Schema, type Types } from 'mongoose';

import { tenantScopePlugin } from './plugins/tenantScope.js';

export interface ProductImage {
  publicId: string;
  url: string;
  isPrimary: boolean;
}

export interface ProductSupplier {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
}

export interface ProductDoc {
  /** Owning tenant (SaaS). Added by the tenantScope plugin; declared here for types. */
  tenantId: Types.ObjectId;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  categoryId: Types.ObjectId;
  costPrice: Types.Decimal128;
  sellingPrice: Types.Decimal128;
  quantity: number;
  lowStockThreshold: number;
  supplier?: ProductSupplier;
  images: ProductImage[];
  isArchived: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const imageSchema = new Schema<ProductImage>(
  {
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    isPrimary: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const supplierSchema = new Schema<ProductSupplier>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    contactName: { type: String, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 30 },
    email: { type: String, trim: true, maxlength: 254 },
  },
  { _id: false },
);

const productSchema = new Schema<ProductDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    sku: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 32 }, // BR-02
    barcode: { type: String, trim: true, maxlength: 64 }, // sparse-unique (PDV-04: unset, never '')
    description: { type: String, maxlength: 2000 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    costPrice: { type: Schema.Types.Decimal128, required: true }, // BR-08 — ≥ 0, 2 dp
    sellingPrice: { type: Schema.Types.Decimal128, required: true },
    quantity: { type: Number, required: true, default: 0, min: 0 }, // BR-10; DN-1 single-writer
    lowStockThreshold: { type: Number, required: true, min: 0 }, // default copied from Settings (DN-3)
    supplier: { type: supplierSchema, required: false },
    images: { type: [imageSchema], default: [] },
    isArchived: { type: Boolean, required: true, default: false },
    version: { type: Number, required: true, default: 0 }, // BR-24 (explicit, not __v)
  },
  { timestamps: true, versionKey: false },
);

productSchema.plugin(tenantScopePlugin);

// DBD §2.3 index set — now tenant-LEADING (every query filters by tenant first).
// SKU / barcode uniqueness is PER-TENANT (SCA-02, no COLLSCAN):
productSchema.index({ tenantId: 1, sku: 1 }, { unique: true }); // lookup SKU-fallback + duplicate guard
// A compound "sparse" index would NOT skip null barcodes (tenantId is always
// present), so use a partial index: unique only among docs that HAVE a barcode.
productSchema.index(
  { tenantId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } }, // lookup barcode-primary
);
productSchema.index({ tenantId: 1, categoryId: 1, isArchived: 1, createdAt: -1 }); // category lists + refs
productSchema.index({ tenantId: 1, isArchived: 1, quantity: 1 }); // low/out-of-stock + dashboard counts
productSchema.index({ tenantId: 1, isArchived: 1, createdAt: -1 }); // default list sort

export const Product = model<ProductDoc>('Product', productSchema);
