/**
 * Orphan image sweep — BR-38 / BEV-04. Closes the Phase-2 accepted window where
 * a Cloudinary asset can outlive its product reference (a failed save, a replaced
 * image whose post-commit destroy was lost).
 *
 * Discovery (BEV-04): list the `ims/prod` folder via the Cloudinary Admin API and
 * cross-reference every asset against `products.images.publicId`. An asset that
 * is unreferenced AND older than 24 h is destroyed — the age grace avoids racing
 * an upload whose product save is still in flight. Signature scoping makes the
 * folder listing authoritative (nothing lands outside `ims/prod`).
 */
import type { CloudinaryClient } from '../lib/cloudinary.js';
import type { Logger } from '../lib/logger.js';
import { Product } from '../models/Product.js';
import { UPLOAD_FOLDER } from '../services/UploadService.js';

const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

export interface SweepReport {
  listed: number;
  referenced: number;
  destroyed: string[];
}

export interface OrphanSweepDeps {
  cloudinary: Pick<CloudinaryClient, 'listFolder' | 'destroy'>;
  logger: Pick<Logger, 'warn' | 'info'>;
  now?: () => number;
  /** Minimum orphan age before destruction (default 24 h). */
  minAgeMs?: number;
}

export async function runOrphanSweep(deps: OrphanSweepDeps): Promise<SweepReport> {
  const minAgeMs = deps.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const nowMs = (deps.now ?? Date.now)();

  const [assets, referenced] = await Promise.all([
    deps.cloudinary.listFolder(UPLOAD_FOLDER),
    referencedPublicIds(),
  ]);

  const destroyed: string[] = [];
  for (const asset of assets) {
    if (referenced.has(asset.publicId)) continue; // still in use
    if (nowMs - asset.createdAt.getTime() < minAgeMs) continue; // too young — save may be in flight

    const { result } = await deps.cloudinary
      .destroy(asset.publicId)
      .catch(() => ({ result: 'error' }));
    if (result === 'ok') destroyed.push(asset.publicId);
    else deps.logger.warn({ publicId: asset.publicId, result }, 'orphan sweep destroy failed');
  }

  deps.logger.info(
    { listed: assets.length, referenced: referenced.size, destroyed: destroyed.length },
    'orphan sweep complete',
  );
  return { listed: assets.length, referenced: referenced.size, destroyed };
}

/** Every publicId currently referenced by a product image. */
async function referencedPublicIds(): Promise<Set<string>> {
  const products = await Product.find({ 'images.0': { $exists: true } })
    .select('images.publicId')
    .lean();
  const referenced = new Set<string>();
  for (const product of products) {
    for (const image of product.images ?? []) referenced.add(image.publicId);
  }
  return referenced;
}
