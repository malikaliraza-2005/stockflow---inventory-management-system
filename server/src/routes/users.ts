/**
 * `/users` router — path + middleware chain + controller reference ONLY
 * (BEA §2). Role annotations are SPREAD FROM THE GENERATED MATRIX
 * (config/permissionMatrix.ts — the SRS §5.2 single authority, AAD §5.1):
 * no role literal appears in this file.
 *
 * This router is `authorize`'s FIRST consumer (first-consumer law) — the
 * BEV-03 denial window goes live here.
 *
 * Order matters: `/me` before `/:id` (otherwise "me" parses as an id).
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createUsersController } from '../controllers/usersController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate, validateObjectId } from '../middleware/validate.js';
import {
  meUpdateSchema,
  userCreateSchema,
  usersQuerySchema,
  userUpdateSchema,
} from '../validation/schemas/users.js';

export interface UsersRouterDeps {
  controller: ReturnType<typeof createUsersController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createUsersRouter(deps: UsersRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const manageUsers = authorize(...rolesFor('users.manage'));
  const ownProfile = authorize(...rolesFor('profile.own'));

  router.get('/', authenticate, manageUsers, validate(usersQuerySchema, 'query'), controller.list);
  router.post('/', authenticate, manageUsers, validate(userCreateSchema), controller.create);

  router.get('/me', authenticate, ownProfile, controller.getMe);
  router.patch('/me', authenticate, ownProfile, validate(meUpdateSchema), controller.updateMe);

  router.get('/:id', authenticate, manageUsers, validateObjectId('id'), controller.getById);
  router.patch(
    '/:id',
    authenticate,
    manageUsers,
    validateObjectId('id'),
    validate(userUpdateSchema),
    controller.update,
  );
  router.post(
    '/:id/reset-password',
    authenticate,
    manageUsers,
    validateObjectId('id'),
    controller.resetPassword,
  );

  return router;
}
