/**
 * Products controllers — HTTP concerns only (BEA §2): validated input → ONE
 * ProductService method → serializer. Zero business logic.
 *
 * The one HTTP-layer rule that lives here (not in the service): the `archived`
 * list filter is Admin-only (APD-02) — a Staff request carrying it is 403, so
 * Staff cannot enumerate archived catalog. The role gate belongs at the HTTP
 * boundary because it is about who may ASK, not about the data shape.
 */
import type { RequestHandler } from 'express';

import { ForbiddenError } from '../errors/AppError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  serializeProduct,
  serializeProductLookup,
  serializeProductRow,
} from '../serializers/product.js';
import type { ProductService } from '../services/ProductService.js';
import type {
  ProductCreateInput,
  ProductLookupQuery,
  ProductsQuery,
  ProductUpdateInput,
} from '../validation/schemas/products.js';

export function createProductsController(productService: ProductService) {
  const list: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ProductsQuery;
    // APD-02: only Admin may filter by archival state.
    if (query.archived !== undefined && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('Only administrators can view archived products.');
    }
    const { categoryNames, ...envelope } = await productService.list(query);
    res.json({
      ...envelope,
      data: envelope.data.map((p) =>
        serializeProductRow(p, { categoryName: categoryNames.get(p.categoryId.toString()) }),
      ),
    });
  });

  const create: RequestHandler = asyncHandler(async (req, res) => {
    const { product, categoryName } = await productService.create(
      req.body as ProductCreateInput,
      req.user!._id,
      { ip: req.ip },
    );
    res.status(201).json(serializeProduct(product, { categoryName }));
  });

  const lookup: RequestHandler = asyncHandler(async (req, res) => {
    const { code } = req.query as unknown as ProductLookupQuery;
    const product = await productService.lookup(code);
    res.json(serializeProductLookup(product));
  });

  const getById: RequestHandler = asyncHandler(async (req, res) => {
    const { product, categoryName } = await productService.getById(req.params.id as string);
    res.json(serializeProduct(product, { categoryName }));
  });

  const update: RequestHandler = asyncHandler(async (req, res) => {
    const { product, categoryName } = await productService.update(
      req.params.id as string,
      req.body as ProductUpdateInput,
      req.user!._id,
      { ip: req.ip },
    );
    res.json(serializeProduct(product, { categoryName }));
  });

  const archive: RequestHandler = asyncHandler(async (req, res) => {
    const { product, categoryName } = await productService.archive(
      req.params.id as string,
      req.user!._id,
      {
        ip: req.ip,
      },
    );
    res.json(serializeProduct(product, { categoryName }));
  });

  const restore: RequestHandler = asyncHandler(async (req, res) => {
    const { product, categoryName } = await productService.restore(
      req.params.id as string,
      req.user!._id,
      {
        ip: req.ip,
      },
    );
    res.json(serializeProduct(product, { categoryName }));
  });

  const remove: RequestHandler = asyncHandler(async (req, res) => {
    await productService.hardDelete(req.params.id as string, req.user!._id, { ip: req.ip });
    res.status(204).end();
  });

  return { list, create, lookup, getById, update, archive, restore, remove };
}
