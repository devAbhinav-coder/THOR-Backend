import { Response } from "express";

type Meta = Record<string, unknown>;

export function sendSuccess(
  res: Response,
  data: Record<string, unknown> | null = {},
  message = "OK",
  statusCode = 200,
  meta?: Meta
): void {
  res.status(statusCode).json({
    status: "success",
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function sendPaginated(
  res: Response,
  data: Record<string, unknown>,
  pagination: { page: number; limit: number; total: number },
  message = "OK",
  statusCode = 200
): void {
  const limit = Math.max(1, pagination.limit);
  const totalPages = Math.max(1, Math.ceil(pagination.total / limit));
  const currentPage = pagination.page;
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;
  res.status(statusCode).json({
    status: "success",
    success: true,
    message,
    data,
    pagination: {
      currentPage,
      totalPages,
      total: pagination.total,
      hasNextPage,
      hasPrevPage,
    },
    meta: {
      pagination: {
        currentPage,
        limit: pagination.limit,
        total: pagination.total,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    },
  });
}
