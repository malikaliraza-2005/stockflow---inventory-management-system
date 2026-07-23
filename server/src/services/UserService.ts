/**
 * UserService — BR-29…31 (BEA §4).
 *
 *  - BR-29: accounts are permanent — this service exposes NO delete surface.
 *  - BR-30: the last-admin invariant runs inside T6 (DBD §4): active-admin
 *    count + role/status change + session revocation + audit entry, ONE
 *    transaction with majority concerns.
 *  - BR-31: Admin-only provisioning; temporary passwords force a change.
 *
 * ── The T6 race guard ─────────────────────────────────────────────────────
 * MongoDB snapshot isolation does NOT serialize two transactions demoting
 * two DIFFERENT admin documents: both would read count=2, write disjoint
 * docs, and both commit — zero admins left, invariant broken. Every T6 run
 * that could REDUCE the active-admin count therefore `$inc`s one shared
 * guard document first: concurrent reducers now write-conflict, the loser's
 * transaction retries (withTransaction handles TransientTransactionError —
 * NFR-18/EC-25), re-reads count=1, and gets LAST_ADMIN. The guard lives in
 * `appguards` — an operational collection outside the business data model,
 * same instrument as `jobLocks` (BEV-05).
 *
 * Audit actions (PDV-01, one row per update): isActive change wins
 * (DEACTIVATE/REACTIVATE) over ROLE_CHANGE over UPDATE; `changes[]` carries
 * every diffed field regardless of which action names the row.
 */
import bcrypt from 'bcrypt';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';

import { DuplicateEmailError, LastAdminError, NotFoundError } from '../errors/AppError.js';
import { escapeRegex, listEnvelope, type ListEnvelope } from '../lib/pagination.js';
import { User, type UserDoc } from '../models/User.js';
import { AuditService } from './AuditService.js';
import { revokeSessions, type AuthService, type RequestContext } from './AuthService.js';
import type { UserCreateInput, UserUpdateInput, UsersQuery } from '../validation/schemas/users.js';

const BCRYPT_COST = 12; // BR-32
const GUARD_COLLECTION = 'appguards';
const ADMIN_GUARD_ID = 'lastAdminInvariant';
const MONGO_DUPLICATE_KEY = 11000;

export interface UserServiceDeps {
  audit: AuditService;
  authService: AuthService;
  /** Frontend origin — reset links are assembled for out-of-band delivery (AS-6). */
  clientOrigin: string;
  now?: () => Date;
  /** Test seam — production stays at the BR-32 cost-12 default. */
  bcryptCost?: number;
}

export class UserService {
  private readonly audit: AuditService;
  private readonly authService: AuthService;
  private readonly clientOrigin: string;
  private readonly now: () => Date;
  private readonly bcryptCost: number;

  constructor(deps: UserServiceDeps) {
    this.audit = deps.audit;
    this.authService = deps.authService;
    this.clientOrigin = deps.clientOrigin;
    this.now = deps.now ?? (() => new Date());
    this.bcryptCost = deps.bcryptCost ?? BCRYPT_COST;
  }

  /** GET /users — filters/search/sort per 05 §7.2; plans ride {role, isActive}. */
  async list(query: UsersQuery): Promise<ListEnvelope<HydratedDocument<UserDoc>>> {
    const filter: Record<string, unknown> = {};
    if (query.role) filter.role = query.role;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    const [data, totalItems] = await Promise.all([
      User.find(filter)
        .sort({ [query.sort]: query.order === 'asc' ? 1 : -1, _id: 1 }) // _id tiebreak: stable pages
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      User.countDocuments(filter),
    ]);
    return listEnvelope(data, query.page, query.limit, totalItems);
  }

  async getById(id: string): Promise<HydratedDocument<UserDoc>> {
    const user = await User.findById(id);
    if (!user) throw new NotFoundError('User not found.');
    return user;
  }

  /** BR-31: provisioning — race-safe duplicate handling via the unique index. */
  async create(
    input: UserCreateInput,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<HydratedDocument<UserDoc>> {
    const passwordHash = await bcrypt.hash(input.temporaryPassword, this.bcryptCost);
    let user: HydratedDocument<UserDoc>;
    try {
      user = await User.create({
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
        mustChangePassword: true, // BR-31 — server-set, never client-supplied
      });
    } catch (error) {
      if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY) {
        throw new DuplicateEmailError(); // the index IS the authority (VAL §6)
      }
      throw error;
    }

    await this.audit.record({
      actorId,
      entityType: 'USER',
      entityId: user._id,
      action: 'CREATE',
      entityLabel: user.email, // DN-4
      changes: [{ field: 'role', after: user.role }],
      ip: ctx.ip,
    });
    return user;
  }

  /** PATCH /users/me — `{ name }` only; audited like any entity change. */
  async updateMe(
    userId: Types.ObjectId | string,
    name: string,
    ctx: RequestContext = {},
  ): Promise<HydratedDocument<UserDoc>> {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError('User not found.');

    const changes = AuditService.computeChanges({ name: user.name }, { name }, ['name']);
    if (changes.length > 0) {
      user.name = name;
      await user.save();
      await this.audit.record({
        actorId: userId,
        entityType: 'USER',
        entityId: user._id,
        action: 'UPDATE',
        entityLabel: user.email,
        changes,
        ip: ctx.ip,
      });
    }
    return user;
  }

  /**
   * PATCH /users/:id — T6 (DBD §4): count + change + revocation + audit in
   * ONE majority-concern transaction. See the header for the race guard.
   */
  async update(
    id: string,
    input: UserUpdateInput,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<HydratedDocument<UserDoc>> {
    // Guard doc existence is settled OUTSIDE the transaction: an in-txn
    // first-run upsert race would surface as a non-transient duplicate-key
    // instead of a retryable write conflict.
    await this.ensureAdminGuard();

    const session = await mongoose.startSession();
    try {
      let updated: HydratedDocument<UserDoc> | undefined;
      await session.withTransaction(
        async () => {
          const target = await User.findById(id).session(session);
          if (!target) throw new NotFoundError('User not found.');

          const before = { name: target.name, role: target.role, isActive: target.isActive };
          const nextRole = input.role ?? target.role;
          const nextActive = input.isActive ?? target.isActive;

          const wasActiveAdmin = target.role === 'ADMIN' && target.isActive;
          const staysActiveAdmin = nextRole === 'ADMIN' && nextActive;
          const reducesAdmins = wasActiveAdmin && !staysActiveAdmin;

          if (reducesAdmins) {
            // Force concurrent reducers to collide (see header) …
            await this.touchAdminGuard(session);
            // … then the count is race-safe within this transaction.
            const activeAdmins = await User.countDocuments({
              role: 'ADMIN',
              isActive: true,
            }).session(session);
            if (activeAdmins <= 1) throw new LastAdminError(); // BR-30 (self-demotion included)
          }

          if (input.name !== undefined) target.name = input.name;
          target.role = nextRole;
          target.isActive = nextActive;
          await target.save({ session });

          const after = { name: target.name, role: target.role, isActive: target.isActive };
          const changes = AuditService.computeChanges(before, after, ['name', 'role', 'isActive']);

          const roleChanged = before.role !== after.role;
          const activeChanged = before.isActive !== after.isActive;
          if (roleChanged || (activeChanged && !after.isActive)) {
            // FR-USER-04: demotion/deactivation kills the target's sessions NOW
            await revokeSessions(target._id, { now: this.now(), session });
          }

          if (changes.length > 0) {
            const action = activeChanged
              ? after.isActive
                ? 'REACTIVATE'
                : 'DEACTIVATE'
              : roleChanged
                ? 'ROLE_CHANGE'
                : 'UPDATE';
            await this.audit.record(
              {
                actorId,
                entityType: 'USER',
                entityId: target._id,
                action,
                entityLabel: target.email,
                changes,
                ip: ctx.ip,
              },
              { session },
            );
          }
          updated = target;
        },
        {
          readConcern: { level: 'majority' },
          writeConcern: { w: 'majority' }, // A-1 (ratified)
        },
      );
      return updated as HydratedDocument<UserDoc>;
    } finally {
      await session.endSession();
    }
  }

  /** POST /users/:id/reset-password — delegates to AuthService (it owns reset
   *  semantics, AAD §2); assembles the out-of-band link (AS-6). */
  async issueResetLink(
    targetId: string,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<{ resetLink: string; expiresAt: Date }> {
    const { token, expiresAt } = await this.authService.issueReset(targetId, actorId, ctx);
    return {
      resetLink: `${this.clientOrigin}/reset-password?token=${token}`,
      expiresAt,
    };
  }

  private guardEnsured = false;

  /** Idempotent, non-transactional: the guard doc simply exists. */
  private async ensureAdminGuard(): Promise<void> {
    if (this.guardEnsured) return;
    const guards = this.guardCollection();
    await guards.updateOne(
      { _id: ADMIN_GUARD_ID },
      { $setOnInsert: { version: 0 } },
      { upsert: true },
    );
    this.guardEnsured = true;
  }

  /** In-transaction touch — concurrent admin-reducers write-conflict here. */
  private async touchAdminGuard(session: mongoose.ClientSession): Promise<void> {
    await this.guardCollection().updateOne(
      { _id: ADMIN_GUARD_ID },
      { $inc: { version: 1 } },
      { session },
    );
  }

  private guardCollection() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('UserService requires an active mongoose connection');
    return db.collection<{ _id: string; version: number }>(GUARD_COLLECTION);
  }
}
