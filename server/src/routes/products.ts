/**
 * `/products` router — path + middleware chain + controller reference ONLY
 * (BEA §2). Role annotations are SPREAD FROM THE GENERATED MATRIX
 * (config/permissionMatrix.ts): reads `products.view` (both roles), catalog
 * writes `products.manage` (Admin), lifecycle `products.lifecycle` (Admin).
 *
 * Order matters: `/lookup` before `/:id` (otherwise "lookup" parses as an id).
 * The `images` sub-routes (`products.images`) are F5.
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createProductsController } from '../controllers/productsController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate, validateObjectId } from '../middleware/validate.js';
import {
  productCreateSchema,
  productLookupSchema,
  productsQuerySchema,
  productUpdateSchema,
} from '../validation/schemas/products.js';

export interface ProductsRouterDeps {
  controller: ReturnType<typeof createProductsController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createProductsRouter(deps: ProductsRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const viewProducts = authorize(...rolesFor('products.view'));
  const manageProducts = authorize(...rolesFor('products.manage'));
  const lifecycleProducts = authorize(...rolesFor('products.lifecycle'));

  router.get(
    '/',
    authenticate,
    viewProducts,
    validate(productsQuerySchema, 'query'),
    controller.list,
  );
  router.post('/', authenticate, manageProducts, validate(productCreateSchema), controller.create);

  // before /:id — a literal segment must win over the param
  router.get(
    '/lookup',
    authenticate,
    viewProducts,
    validate(productLookupSchema, 'query'),
    controller.lookup,
  );

  router.get('/:id', authenticate, viewProducts, validateObjectId('id'), controller.getById);
  router.patch(
    '/:id',
    authenticate,
    manageProducts,
    validateObjectId('id'),
    validate(productUpdateSchema),
    controller.update,
  );
  router.post(
    '/:id/archive',
    authenticate,
    lifecycleProducts,
    validateObjectId('id'),
    controller.archive,
  );
  router.post(
    '/:id/restore',
    authenticate,
    lifecycleProducts,
    validateObjectId('id'),
    controller.restore,
  );
  router.delete('/:id', authenticate, lifecycleProducts, validateObjectId('id'), controller.remove);

  return router;
}
