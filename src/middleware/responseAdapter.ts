import { NextFunction, Request, Response } from "express";

function normalizeSuccessBody(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.success === "boolean") {
    return body;
  }

  const status = body.status;
  if (status === "success") {
    return {
      success: true,
      message: typeof body.message === "string" ? body.message : "OK",
      data: (body.data as Record<string, unknown>) ?? {},
      ...(body.pagination ? { meta: { pagination: body.pagination } } : {}),
      ...body,
    };
  }

  if (status === "error" || status === "fail") {
    return {
      success: false,
      message: typeof body.message === "string" ? body.message : "Request failed",
      data: (body.data as Record<string, unknown>) ?? null,
      ...body,
    };
  }

  return body;
}

export const responseAdapter = (_req: Request, res: Response, next: NextFunction): void => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return originalJson(normalizeSuccessBody(body as Record<string, unknown>));
    }
    return originalJson(body);
  }) as Response["json"];
  next();
};
