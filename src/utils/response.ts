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
  const totalPages = Math.max(1, Math.ceil(pagination.total / Math.max(1, pagination.limit)));
  res.status(statusCode).json({
    status: "success",
    success: true,
    message,
    data,
    pagination: {
      currentPage: pagination.page,
      totalPages,
      total: pagination.total,
    },
    meta: {
      pagination: {
        currentPage: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages,
      },
    },
  });
}
