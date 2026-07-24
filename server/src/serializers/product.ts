/**
 * Product serialization — the wire contract slice for F4 (05 §2 / §7.3).
 *
 * Built field-by-field: `_id` → `id` string; **Decimal128 money → 2-dp API
 * string** (DBR-05 — never a float on the wire); dates ISO-8601 UTC; optional-
 * sparse fields absent, never null (05 §2). `stockStatus` is DERIVED, never
 * stored. List rows are PROJECTIONS (no `images` array / no full doc, NFR-05);
 * the detail + lookup shapes surface only what their endpoints declare.
 */
import type { HydratedDocument, Types } from 'mongoose';

import type { ProductDoc, ProductImage } from '../models/Product.js';

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

/** 05 §2 derivation: 0 → OUT; 0 < q ≤ threshold → LOW; else IN. */
export function deriveStockStatus(quantity: number, lowStockThreshold: number): StockStatus {
  if (quantity === 0) return 'OUT_OF_STOCK';
  if (quantity <= lowStockThreshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}

/** Decimal128 → fixed 2-dp string (values are bounded ≤ 9,999,999.99, VAL). */
function money(value: Types.Decimal128): string {
  return Number(value.toString()).toFixed(2);
}

function primaryImageUrl(images: ProductImage[]): string | undefined {
  return images.find((img) => img.isPrimary)?.url;
}

/** Full product (GET /products/:id · POST 201 · PATCH 200). `categoryName` is
 *  attached when the caller has resolved it (populate/join). */
export interface ProductPayload {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  categoryId: string;
  categoryName?: string;
  quantity: number;
  lowStockThreshold: number;
  costPrice: string;
  sellingPrice: string;
  stockStatus: StockStatus;
  supplier?: ProductDoc['supplier'];
  images: ProductImage[];
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function serializeProduct(
  product: HydratedDocument<ProductDoc>,
  opts: { categoryName?: string | undefined } = {},
): ProductPayload {
  return {
    id: product._id.toString(),
    name: product.name,
    sku: product.sku,
    ...(product.barcode ? { barcode: product.barcode } : {}),
    ...(product.description ? { description: product.description } : {}),
    categoryId: product.categoryId.toString(),
    ...(opts.categoryName ? { categoryName: opts.categoryName } : {}),
    quantity: product.quantity,
    lowStockThreshold: product.lowStockThreshold,
    costPrice: money(product.costPrice),
    sellingPrice: money(product.sellingPrice),
    stockStatus: deriveStockStatus(product.quantity, product.lowStockThreshold),
    ...(product.supplier ? { supplier: product.supplier } : {}),
    images: product.images,
    isArchived: product.isArchived,
    version: product.version,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

/** List row projection (GET /products) — no image array, no version (NFR-05). */
export interface ProductRowPayload {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  thumbnailUrl?: string;
  categoryName?: string;
  quantity: number;
  lowStockThreshold: number;
  stockStatus: StockStatus;
  costPrice: string;
  sellingPrice: string;
  isArchived: boolean;
}

export function serializeProductRow(
  product: HydratedDocument<ProductDoc>,
  opts: { categoryName?: string | undefined } = {},
): ProductRowPayload {
  const thumbnailUrl = primaryImageUrl(product.images);
  return {
    id: product._id.toString(),
    name: product.name,
    sku: product.sku,
    ...(product.barcode ? { barcode: product.barcode } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(opts.categoryName ? { categoryName: opts.categoryName } : {}),
    quantity: product.quantity,
    lowStockThreshold: product.lowStockThreshold,
    stockStatus: deriveStockStatus(product.quantity, product.lowStockThreshold),
    costPrice: money(product.costPrice),
    sellingPrice: money(product.sellingPrice),
    isArchived: product.isArchived,
  };
}

/** Lookup result (GET /products/lookup) — the scanner-facing shape (BR-06/07). */
export interface ProductLookupPayload {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  primaryImageUrl?: string;
  quantity: number;
  stockStatus: StockStatus;
  isArchived: boolean;
}

export function serializeProductLookup(
  product: HydratedDocument<ProductDoc>,
): ProductLookupPayload {
  const imageUrl = primaryImageUrl(product.images);
  return {
    id: product._id.toString(),
    name: product.name,
    sku: product.sku,
    ...(product.barcode ? { barcode: product.barcode } : {}),
    ...(imageUrl ? { primaryImageUrl: imageUrl } : {}),
    quantity: product.quantity,
    stockStatus: deriveStockStatus(product.quantity, product.lowStockThreshold),
    isArchived: product.isArchived,
  };
}
