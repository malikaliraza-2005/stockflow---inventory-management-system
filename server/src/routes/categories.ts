/**
 * `/categories` router — path + middleware chain + controller reference ONLY
 * (BEA §2). Role annotations are SPREAD FROM THE GENERATED MATRIX
 * (config/permissionMatrix.ts — SRS §5.2 single authority): no role literal
 * appears here. Reads are both-roles (`categories.view`); writes are Admin
 * (`categories.manage`) — FR-CAT-03.
 *
 * The DELETE `reassignTo` query param is validated by `categoryDeleteQuerySchema`
 * (an unknown or malformed value fails as VALIDATION_ERROR before the service).
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createCategoriesController } from '../controllers/categoriesController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate, validateObjectId } from '../middleware/validate.js';
import {
  categoriesQuerySchema,
  categoryCreateSchema,
  categoryDeleteQuerySchema,
  categoryUpdateSchema,
} from '../validation/schemas/categories.js';

export interface CategoriesRouterDeps {
  controller: ReturnType<typeof createCategoriesController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createCategoriesRouter(deps: CategoriesRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const viewCategories = authorize(...rolesFor('categories.view'));
  const manageCategories = authorize(...rolesFor('categories.manage'));

  router.get(
    '/',
    authenticate,
    viewCategories,
    validate(categoriesQuerySchema, 'query'),
    controller.list,
  );
  router.post(
    '/',
    authenticate,
    manageCategories,
    validate(categoryCreateSchema),
    controller.create,
  );

  router.get('/:id', authenticate, viewCategories, validateObjectId('id'), controller.getById);
  router.patch(
    '/:id',
    authenticate,
    manageCategories,
    validateObjectId('id'),
    validate(categoryUpdateSchema),
    controller.update,
  );
  router.delete(
    '/:id',
    authenticate,
    manageCategories,
    validateObjectId('id'),
    validate(categoryDeleteQuerySchema, 'query'),
    controller.remove,
  );

  return router;
}
