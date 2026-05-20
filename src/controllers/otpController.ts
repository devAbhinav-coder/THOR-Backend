import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import AppError from "../utils/AppError";
import catchAsync from "../utils/catchAsync";
import { sendSuccess } from "../utils/response";
import {
  sendOtp,
  resendOtp,
  verifyOtp,
  createVerifiedSignupUser,
  RESEND_COOLDOWN_SEC,
} from "../services/otpAuthService";
import { sendAuthResponse } from "../services/authTokenService";
import { emitAuthEvent } from "../services/authEventService";
import { authRequestMeta } from "../auth/authNormalize";
import { toAppError, type ServiceError } from "../auth/authErrors";
import { securityLog } from "../utils/securityLog";
import logger from "../utils/logger";
import { normalizeIdempotencyKey } from "../services/checkoutConcurrency";
import {
  getIdempotentAuthVerifyResponse,
  setIdempotentAuthVerifyResponse,
} from "../services/authConcurrency";
import {
  sendOtpSchema,
  resendOtpSchema,
  verifyOtpSchema,
} from "../validation/schemas";

type SendOtpBody = z.infer<typeof sendOtpSchema>["body"];
type ResendOtpBody = z.infer<typeof resendOtpSchema>["body"];
type VerifyOtpBody = z.infer<typeof verifyOtpSchema>["body"];

function handleAuthServiceError(
  e: unknown,
  next: NextFunction,
  fallbackMessage: string,
  fallbackStatus = 503,
): void {
  const err = e as ServiceError;
  if (err.statusCode) {
    return next(toAppError(err));
  }
  logger.error(`${fallbackMessage}: ${(e as Error).message}`);
  return next(new AppError(fallbackMessage, fallbackStatus));
}

function buildVerifyIdempotencyScope(body: VerifyOtpBody): string {
  return `forgot:${body.email}`;
}

/** POST /api/auth/send-otp */
export const postSendOtp = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as SendOtpBody;
    const meta = authRequestMeta(req);

    try {
      if (body.type === "signup") {
        await sendOtp({
          flow: "signup",
          email: body.email,
          signup: {
            name: body.name,
            email: body.email,
            password: body.password,
            phone: body.phone,
          },
        });
      } else {
        await sendOtp({ flow: body.type, email: body.email });
      }
    } catch (e) {
      return handleAuthServiceError(
        e,
        next,
        "Could not send verification email. Please try again shortly.",
      );
    }

    securityLog("auth.otp_send", { flow: body.type, ip: meta.ip });

    const msg =
      body.type === "forgot_password" ?
        "If an account exists for this email, you will receive a code shortly."
      : "Verification code sent to your email.";

    sendSuccess(
      res,
      { type: body.type, retryAfter: RESEND_COOLDOWN_SEC },
      msg,
    );
  },
);

/** POST /api/auth/resend-otp */
export const postResendOtp = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as ResendOtpBody;

    try {
      await resendOtp({ flow: body.type, email: body.email });
    } catch (e) {
      return handleAuthServiceError(
        e,
        next,
        "Could not resend the code. Please try again shortly.",
      );
    }

    const msg =
      body.type === "forgot_password" ?
        "If an account exists for this email, you will receive a code shortly."
      : "A new verification code was sent to your email.";

    sendSuccess(
      res,
      { type: body.type, retryAfter: RESEND_COOLDOWN_SEC },
      msg,
    );
  },
);

/** POST /api/auth/verify-otp */
export const postVerifyOtp = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as VerifyOtpBody;
    const meta = authRequestMeta(req);
    const idemKey = normalizeIdempotencyKey(req.headers["idempotency-key"] as string | undefined);
    const idemScope = buildVerifyIdempotencyScope(body);
    const useIdempotency = Boolean(idemKey && body.type === "forgot_password");

    if (useIdempotency && idemKey) {
      const cached = await getIdempotentAuthVerifyResponse(idemScope, idemKey);
      if (cached) {
        securityLog("auth.otp_idempotent_replay", { flow: body.type, ip: meta.ip });
        return res.status(cached.statusCode).json(cached.body as Record<string, unknown>);
      }
    }

    const result = await verifyOtp({
      flow: body.type,
      email: body.email,
      otp: body.otp,
      ip: meta.ip,
    });

    if (!result.ok) {
      if (result.statusCode === 429) {
        securityLog("auth.otp_verify_throttled", { flow: body.type, ip: meta.ip });
      } else {
        securityLog("auth.otp_verify_failed", { flow: body.type, ip: meta.ip });
      }
      return next(new AppError(result.message, result.statusCode, result.retryAfter));
    }

    if (result.flow === "signup") {
      const { signupPayload, email: emailLower } = result;
      const user = await createVerifiedSignupUser(emailLower, signupPayload);
      emitAuthEvent({
        type: "AUTH_SIGNUP_COMPLETED",
        userId: String(user._id),
        email: user.email,
        req,
        meta: { deviceLabel: meta.deviceLabel },
      });
      securityLog("auth.otp_verify_success", { flow: "signup", userId: String(user._id) });
      await sendAuthResponse(res, user, 201, req);
      return;
    }

    if (result.flow === "login") {
      emitAuthEvent({
        type: "AUTH_LOGIN_SUCCESS",
        userId: String(result.user._id),
        email: result.user.email,
        req,
        meta: { deviceLabel: meta.deviceLabel },
      });
      securityLog("auth.otp_verify_success", { flow: "login", userId: String(result.user._id) });
      await sendAuthResponse(res, result.user, 200, req);
      return;
    }

    const forgotBody = {
      status: "success" as const,
      data: { verified: true, resetToken: result.resetToken },
      message: "Code verified. You can set a new password.",
    };
    if (useIdempotency && idemKey) {
      await setIdempotentAuthVerifyResponse(idemScope, idemKey, 200, forgotBody);
    }
    securityLog("auth.otp_verify_success", { flow: "forgot_password" });
    sendSuccess(
      res,
      { verified: true, resetToken: result.resetToken },
      "Code verified. You can set a new password.",
    );
  },
);
