import AppError from "./AppError";

export function safeJsonParse<T>(
  raw: unknown,
  fallback: T,
  fieldName: string
): T {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  if (typeof raw !== "string") {
    return raw as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AppError(`Invalid JSON format for ${fieldName}.`, 400);
  }
}
