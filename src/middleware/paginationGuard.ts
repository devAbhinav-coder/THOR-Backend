import { NextFunction, Request, Response } from "express";

const MAX_LIMIT = Number(process.env.PAGINATION_MAX_LIMIT || 100);
const DEFAULT_LIMIT = Number(process.env.PAGINATION_DEFAULT_LIMIT || 20);

export const paginationGuard = (req: Request, _res: Response, next: NextFunction): void => {
  const q = req.query as Record<string, unknown>;
  if (q.limit !== undefined) {
    const parsed = Number(q.limit);
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), MAX_LIMIT) : DEFAULT_LIMIT;
    q.limit = String(bounded);
  }
  if (q.page !== undefined) {
    const parsed = Number(q.page);
    q.page = String(Number.isFinite(parsed) ? Math.max(1, parsed) : 1);
  }
  next();
};
