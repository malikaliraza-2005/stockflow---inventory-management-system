/**
 * Products schema — VAL §3.3/§5, client mirror (F4 T-a). Mirrors the server
 * create/update (server/src/validation/schemas/products.ts) for the ProductForm.
 * `images` is added with the F5 ImageUploader; the list-query schema is
 * server-side URL parsing (SMP §4) and is not mirrored.
 *
 * Numeric fields coerce from the form's text inputs; money stays a string (the
 * wire format).
 */
import { z } from 'zod';

import { barcode, cloudinaryPublicId, money, objectId, sku, sparseOptional } from '../primitives';

export const productMessages = {
  name: 'Name: 2–120 characters',
  description: 'Description is too long (2000 max)',
  threshold: 'Enter a whole number ≥ 0',
  quantity: 'Enter a whole number ≥ 0',
  version: 'Missing version — reload and try again',
  supplierName: 'Supplier name is too long (120 max)',
  onePrimary: 'Exactly one image must be primary',
} as const;

/** Images (F5) — publicId folder-anchored; DBR-03 exactly-one-primary. */
const productImage = z.object({
  publicId: cloudinaryPublicId,
  url: z.url(),
  isPrimary: z.boolean(),
});
const images = z
  .array(productImage)
  .max(5)
  .refine((arr) => arr.length === 0 || arr.filter((i) => i.isPrimary).length === 1, {
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
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().max(2000, productMessages.description).optional(),
);

const nonNegInt = (message: string) =>
  z.coerce.number(message).int(message).min(0, message).max(10_000_000, message);

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

/** POST /products — ProductForm create. SKU blank → auto-generated (BR-04). */
export const productCreateSchema = z.object({
  name,
  sku: sparseOptional(sku),
  barcode: sparseOptional(barcode),
  categoryId: objectId,
  description,
  costPrice: money,
  sellingPrice: money,
  initialQuantity: nonNegInt(productMessages.quantity).default(0),
  lowStockThreshold: nonNegInt(productMessages.threshold).optional(),
  supplier,
  images,
});

/** PATCH /products/:id — ProductForm edit. Carries `version`; no SKU/quantity. */
export const productUpdateSchema = z.object({
  version: z.coerce.number(productMessages.version).int().min(0),
  name,
  barcode: sparseOptional(barcode),
  categoryId: objectId,
  description,
  costPrice: money,
  sellingPrice: money,
  lowStockThreshold: nonNegInt(productMessages.threshold).optional(),
  supplier,
  images,
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
