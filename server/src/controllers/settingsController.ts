/**
 * Settings controllers — HTTP concerns only (BEA §2): validated input → ONE
 * SettingsService method → serializer. Zero business logic.
 */
import type { RequestHandler } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { serializeSettings } from '../serializers/settings.js';
import type { SettingsService } from '../services/SettingsService.js';
import type { SettingsUpdateInput } from '../validation/schemas/settings.js';

export function createSettingsController(settingsService: SettingsService) {
  const get: RequestHandler = asyncHandler(async (_req, res) => {
    const settings = await settingsService.get();
    res.json(serializeSettings(settings));
  });

  const update: RequestHandler = asyncHandler(async (req, res) => {
    const settings = await settingsService.update(req.body as SettingsUpdateInput, req.user!._id, {
      ip: req.ip,
    });
    res.json(serializeSettings(settings));
  });

  return { get, update };
}
