import AppError from "../utils/AppError";

/** Same copy for every failed password login — avoids account enumeration. */
export const LOGIN_FAILED_GENERIC = "Invalid email or password.";

export const OTP_INVALID = "Invalid or expired verification code.";
export const OTP_TOO_MANY = "Too many attempts. Please request a new code.";
export const SESSION_EXPIRED = "Session expired. Please sign in again.";
export const RESET_GENERIC =
  "If an account exists for this email, you will receive a reset code shortly.";

export function authAppError(
  message: string,
  statusCode: number,
): AppError {
  return new AppError(message, statusCode);
}

export type ServiceError = Error & { statusCode: number; retryAfter?: number };

export function serviceError(
  message: string,
  statusCode: number,
  retryAfter?: number,
): ServiceError {
  const e = new Error(message) as ServiceError;
  e.statusCode = statusCode;
  if (retryAfter != null && retryAfter > 0) {
    e.retryAfter = Math.ceil(retryAfter);
  }
  return e;
}

export function toAppError(err: ServiceError | Error & { statusCode?: number }): AppError {
  const statusCode = err.statusCode ?? 500;
  const retryAfter = 'retryAfter' in err ? err.retryAfter : undefined;
  return new AppError(err.message, statusCode, retryAfter);
}
