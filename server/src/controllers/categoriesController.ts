/**
 * Categories controllers — HTTP concerns only (BEA §2): validated input → ONE
 * CategoryService method → serializer. Zero business logic.
 */
import type { RequestHandler } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { serializeCategory } from '../serializers/category.js';
import type { CategoryService } from '../services/CategoryService.js';
import type {
  CategoriesQuery,
  CategoryCreateInput,
  CategoryDeleteQuery,
  CategoryUpdateInput,
} from '../validation/schemas/categories.js';

export function createCategoriesController(categoryService: CategoryService) {
  const list: RequestHandler = asyncHandler(async (req, res) => {
    const { counts, ...envelope } = await categoryService.list(
      req.query as unknown as CategoriesQuery,
    );
    res.json({
      ...envelope,
      data: envelope.data.map((c) => serializeCategory(c, counts?.get(c._id.toString()))),
    });
  });

  const create: RequestHandler = asyncHandler(async (req, res) => {
    const category = await categoryService.create(req.body as CategoryCreateInput, req.user!._id, {
      ip: req.ip,
    });
    res.status(201).json(serializeCategory(category));
  });

  const getById: RequestHandler = asyncHandler(async (req, res) => {
    const category = await categoryService.getById(req.params.id as string);
    res.json(serializeCategory(category));
  });

  const update: RequestHandler = asyncHandler(async (req, res) => {
    const category = await categoryService.update(
      req.params.id as string,
      req.body as CategoryUpdateInput,
      req.user!._id,
      { ip: req.ip },
    );
    res.json(serializeCategory(category));
  });

  const remove: RequestHandler = asyncHandler(async (req, res) => {
    await categoryService.delete(
      req.params.id as string,
      req.query as unknown as CategoryDeleteQuery,
      req.user!._id,
      { ip: req.ip },
    );
    res.status(204).end();
  });

  return { list, create, getById, update, remove };
}
