/**
 * Upload controllers — HTTP concerns only (BEA §2). The `:publicId` path param
 * is percent-encoded by the client because a Cloudinary publicId contains `/`
 * (`ims/prod/abc`); Express delivers it decoded (APR-03).
 */
import type { RequestHandler } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import type { UploadService } from '../services/UploadService.js';

export function createUploadController(uploadService: UploadService) {
  const signature: RequestHandler = asyncHandler(async (_req, res) => {
    // request body (contentType, size) is validated by the schema (BR-36)
    res.json(uploadService.createSignature());
  });

  const destroy: RequestHandler = asyncHandler(async (req, res) => {
    await uploadService.destroy(req.params.publicId as string);
    res.status(204).end();
  });

  return { signature, destroy };
}
