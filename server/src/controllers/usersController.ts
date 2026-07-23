/**
 * Users controllers — HTTP concerns only (BEA §2): validated input → ONE
 * UserService method → serializer. Zero business logic.
 */
import type { RequestHandler } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { serializeOwnProfile, serializeUser } from '../serializers/user.js';
import type { UserService } from '../services/UserService.js';
import type {
  MeUpdateInput,
  UserCreateInput,
  UserUpdateInput,
  UsersQuery,
} from '../validation/schemas/users.js';

export function createUsersController(userService: UserService) {
  const list: RequestHandler = asyncHandler(async (req, res) => {
    const envelope = await userService.list(req.query as unknown as UsersQuery);
    res.json({ ...envelope, data: envelope.data.map(serializeUser) });
  });

  const create: RequestHandler = asyncHandler(async (req, res) => {
    const user = await userService.create(req.body as UserCreateInput, req.user!._id, {
      ip: req.ip,
    });
    res.status(201).json(serializeUser(user));
  });

  const getMe: RequestHandler = asyncHandler(async (req, res) => {
    // authenticate already loaded the live record — no second read
    res.json(serializeOwnProfile(req.user!));
  });

  const updateMe: RequestHandler = asyncHandler(async (req, res) => {
    const { name } = req.body as MeUpdateInput;
    const user = await userService.updateMe(req.user!._id, name, { ip: req.ip });
    res.json(serializeOwnProfile(user));
  });

  const getById: RequestHandler = asyncHandler(async (req, res) => {
    const user = await userService.getById(req.params.id as string);
    res.json(serializeUser(user));
  });

  const update: RequestHandler = asyncHandler(async (req, res) => {
    const user = await userService.update(
      req.params.id as string,
      req.body as UserUpdateInput,
      req.user!._id,
      { ip: req.ip },
    );
    res.json(serializeUser(user));
  });

  const resetPassword: RequestHandler = asyncHandler(async (req, res) => {
    const { resetLink, expiresAt } = await userService.issueResetLink(
      req.params.id as string,
      req.user!._id,
      { ip: req.ip },
    );
    res.json({ resetLink, expiresAt: expiresAt.toISOString() });
  });

  return { list, create, getMe, updateMe, getById, update, resetPassword };
}
