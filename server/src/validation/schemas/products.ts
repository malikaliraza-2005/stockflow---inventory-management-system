/**
 * Products endpoint schemas — VAL §3.3 / §5 "Products" (F4 T-a); DBD §2.3.
 *
 * Server-owned fields never appear in a request schema (unknown-key stripping,
 * VAL §2): `quantity` (MovementService-only, BR-17), `isArchived` (archive/
 * restore routes only), `sku` on UPDATE (immutable, BR-03), `version` on CREATE.
 *
 * `images` is intentionally NOT accepted here — the image pipeline (signed
 * uploads, host-pinned URL validation, exactly-one-primary DBR-03, destroy-on-
 * replace) is F5's cohesive slice, and a valid Cloudinary publicId can only
 * come from an F5 upload. The Product model holds the field (default []).
 *
 * MIRROR: client/src/lib/validation/schemas/products.ts (create/update) — ships
 * with the F4 frontend task (ProductForm).
 */
import { z } from 'zod';

import {
  barcode,
  cloudinaryPublicId,
  money,
  objectId,
  quantityInt,
  sku,
  sparseOptional,
} from '../primitives.js';

export const productMessages = {
  name: 'Name: 2–120 characters',
  description: 'Description is too long (2000 max)',
  threshold: 'Enter a whole number ≥ 0',
  version: 'Missing version — refresh and try again',
  nothingToUpdate: 'Provide at least one field to update',
  supplierName: 'Supplier name is too long (120 max)',
  search: 'Search is too long (120 max)',
  imageUrl: 'Invalid image URL',
  imagesMax: 'Up to 5 images',
  onePrimary: 'Exactly one image must be primary',
} as const;

/**
 * Images (F5) — publicId is folder-anchored (`ims/prod/…`, the security control,
 * VAL Issue 4); the URL's host-pinning to the configured delivery host is
 * enforced in ProductService (it needs the runtime host). DBR-03 exactly-one-
 * primary is refined here (structural) and re-affirmed by the service.
 */
const productImage = z.object({
  publicId: cloudinaryPublicId,
  url: z.url(productMessages.imageUrl),
  isPrimary: z.boolean(),
});

const images = z
  .array(productImage)
  .max(5, productMessages.imagesMax)
  .refine((arr) => arr.length === 0 || arr.filter((img) => img.isPrimary).length === 1, {
    message: productMessages.onePrimary,
    path: ['images'],
  })
  .optional();

const name = z
  .string(productMessages.name)
  .trim()
  .min(2, productMessages.name)
  .max(120, productMessages.name);

const description = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(2000, productMessages.description).optional(),
);

/** ≥ 0 whole number; shares the BR-10 numeric envelope. */
const nonNegativeInt = z
  .number(productMessages.threshold)
  .int(productMessages.threshold)
  .min(0, productMessages.threshold)
  .max(10_000_000, productMessages.threshold);

/** Embedded supplier value object (DBD §2.3) — name required when present. */
const supplier = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, productMessages.supplierName)
      .max(120, productMessages.supplierName),
    contactName: z.string().trim().max(80).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(254).optional(),
  })
  .optional();

/** POST /products — §15.4 create. SKU optional (blank → auto BR-04). */
export const productCreateSchema = z.object({
  name,
  sku: sku.optional(), // absent/blank → auto-generated from the category prefix
  barcode: sparseOptional(barcode),
  categoryId: objectId,
  description,
  costPrice: money,
  sellingPrice: money,
  initialQuantity: quantityInt.default(0),
  lowStockThreshold: nonNegativeInt.optional(), // absent → copied from Settings (DN-3)
  supplier,
  images, // F5 — ≤ 5, exactly one primary
});

/** PATCH /products/:id — §15.4 update. Carries `version` (BR-24); rejects sku
 *  (immutable), quantity (MovementService), isArchived (lifecycle routes). */
export const productUpdateSchema = z
  .object({
    version: z.number(productMessages.version).int().min(0),
    name: name.optional(),
    barcode: sparseOptional(barcode),
    categoryId: objectId.optional(),
    description,
    costPrice: money.optional(),
    sellingPrice: money.optional(),
    lowStockThreshold: nonNegativeInt.optional(),
    supplier,
    images, // F5 — replace the whole set; removed publicIds are destroyed post-commit
  })
  .refine(
    (body) => Object.entries(body).some(([key, value]) => key !== 'version' && value !== undefined),
    { message: productMessages.nothingToUpdate, path: ['(body)'] },
  );

/** GET /products query — §7.3 filters/sort. `archived` is an Admin-only param
 *  (APD-02) — the role gate is enforced in the controller, not the schema. */
export const productsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20), // NFR-10
  search: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().max(120, productMessages.search).optional(),
    )
    .optional(),
  categoryId: objectId.optional(),
  stockStatus: z.enum(['in', 'low', 'out']).optional(),
  /** Inclusive quantity bounds (FR-SRCH). Independent of `stockStatus`, which
   *  answers "is it low RELATIVE to its own threshold"; these answer "how many
   *  units", which is a different question people ask constantly. */
  minQuantity: z.coerce.number().int().min(0).max(10_000_000).optional(),
  maxQuantity: z.coerce.number().int().min(0).max(10_000_000).optional(),
  archived: z
    .preprocess((value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }, z.boolean())
    .optional(),
  sort: z.enum(['name', 'sku', 'quantity', 'createdAt', 'costPrice']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/** GET /products/lookup — PRESENCE only here: the BR-16 well-formedness check
 *  (printable, ≤ 64) lives in the SERVICE so a malformed payload is a 422
 *  INVALID_BARCODE (05 §7.3), not a 400. An empty/missing `code` is still a 400. */
export const productLookupSchema = z.object({
  code: z.string().trim().min(1),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type ProductsQuery = z.infer<typeof productsQuerySchema>;
export type ProductLookupQuery = z.infer<typeof productLookupSchema>;
