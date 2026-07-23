/**
 * Express 4 does not route async rejections to the error chain — every async
 * controller/middleware is wrapped so a rejected promise reaches the ONE
 * terminal errorHandler (ERR §3) instead of hanging the request.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
