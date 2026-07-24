/**
 * SettingsService — BR-41 (BEA §6). The settings singleton is seeded and
 * boot-integrity-checked (a missing document is a startup failure, never a
 * runtime default), so reads always find it and writes update it IN PLACE —
 * this service never creates a second document.
 *
 * DN-3 (copy semantics): `defaultLowStockThreshold` is copied into each product
 * at CREATE time (ProductService). Editing settings here NEVER rewrites existing
 * products — the threshold change reaches new products only. This service
 * therefore touches only the singleton; there is no product-fan-out path.
 *
 * Changes are audited through F2's diff path (entityType SETTINGS, before/after
 * per field) — FR-TXN-04.
 */
import type { HydratedDocument, Types } from 'mongoose';

import { NotFoundError } from '../errors/AppError.js';
import { Settings, type SettingsDoc } from '../models/Settings.js';
import { AuditService } from './AuditService.js';
import type { RequestContext } from './AuthService.js';
import type { SettingsUpdateInput } from '../validation/schemas/settings.js';

const AUDITED_FIELDS = [
  'currency',
  'defaultLowStockThreshold',
  'movementWarningThreshold',
] as const;
const SETTINGS_LABEL = 'System Settings'; // DN-4: the singleton's display identity

export interface SettingsServiceDeps {
  audit: AuditService;
}

export class SettingsService {
  private readonly audit: AuditService;

  constructor(deps: SettingsServiceDeps) {
    this.audit = deps.audit;
  }

  /** GET /settings — the seeded singleton (BR-41). */
  async get(): Promise<HydratedDocument<SettingsDoc>> {
    const settings = await Settings.findOne();
    if (!settings) throw new NotFoundError('Settings not found.'); // integrity should prevent this
    return settings;
  }

  /** PUT /settings — full-object replace of the singleton + audit diff. */
  async update(
    input: SettingsUpdateInput,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<HydratedDocument<SettingsDoc>> {
    const settings = await this.get();

    const before = pick(settings);
    settings.currency = input.currency;
    settings.defaultLowStockThreshold = input.defaultLowStockThreshold;
    settings.movementWarningThreshold = input.movementWarningThreshold;
    const after = pick(settings);
    const changes = AuditService.computeChanges(before, after, AUDITED_FIELDS);

    if (changes.length > 0) {
      await settings.save();
      await this.audit.record({
        actorId,
        entityType: 'SETTINGS',
        entityId: settings._id,
        action: 'UPDATE',
        entityLabel: SETTINGS_LABEL,
        changes,
        ip: ctx.ip,
      });
    }
    return settings;
  }
}

function pick(settings: HydratedDocument<SettingsDoc>): Record<string, unknown> {
  return {
    currency: settings.currency,
    defaultLowStockThreshold: settings.defaultLowStockThreshold,
    movementWarningThreshold: settings.movementWarningThreshold,
  };
}
