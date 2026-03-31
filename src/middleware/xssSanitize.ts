import sanitizeHtml from "sanitize-html";
import { NextFunction, Request, Response } from "express";

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

const sanitizeValue = (value: JsonLike): JsonLike => {
  if (typeof value === "string") {
    return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item as JsonLike));
  }
  if (value && typeof value === "object") {
    const out: Record<string, JsonLike> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = sanitizeValue(nested as JsonLike);
    }
    return out;
  }
  return value;
};

export const xssSanitize = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body as JsonLike) as Request["body"];
  }
  if (req.query && typeof req.query === "object") {
    req.query = sanitizeValue(req.query as JsonLike) as Request["query"];
  }
  if (req.params && typeof req.params === "object") {
    req.params = sanitizeValue(req.params as JsonLike) as Request["params"];
  }
  next();
};
