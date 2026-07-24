/**
 * `/upload` router — §7.9 Uploads (F5). Both routes are Admin (`products.images`,
 * spread from the generated matrix). No role literal appears here.
 *
 * The `:publicId` param captures a percent-encoded Cloudinary publicId (it
 * contains `/`); Express decodes it. Folder-scope enforcement (APR-03) is in
 * UploadService, not here.
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createUploadController } from '../controllers/uploadController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { uploadSignatureSchema } from '../validation/schemas/uploads.js';

export interface UploadRouterDeps {
  controller: ReturnType<typeof createUploadController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createUploadRouter(deps: UploadRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const manageImages = authorize(...rolesFor('products.images'));

  router.post(
    '/signature',
    authenticate,
    manageImages,
    validate(uploadSignatureSchema),
    controller.signature,
  );
  router.delete('/:publicId', authenticate, manageImages, controller.destroy);

  return router;
}
