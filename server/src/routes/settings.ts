/**
 * `/settings` router — path + middleware chain + controller reference ONLY
 * (BEA §2). Both routes are Admin (`settings.manage`, spread from the generated
 * matrix). GET stays Admin-only by design: Staff reads the same display
 * constants from the login/refresh session payload (FCM-01 / AAD §12), never
 * from this endpoint.
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createSettingsController } from '../controllers/settingsController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { settingsUpdateSchema } from '../validation/schemas/settings.js';

export interface SettingsRouterDeps {
  controller: ReturnType<typeof createSettingsController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createSettingsRouter(deps: SettingsRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const manageSettings = authorize(...rolesFor('settings.manage'));

  router.get('/', authenticate, manageSettings, controller.get);
  router.put('/', authenticate, manageSettings, validate(settingsUpdateSchema), controller.update);

  return router;
}
