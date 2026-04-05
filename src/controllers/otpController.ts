import { Request, Response, NextFunction } from "express";
import AppError from "../utils/AppError";
import catchAsync from "../utils/catchAsync";
import { sendSuccess } from "../utils/response";
import {
  sendOtp,
  resendOtp,
  verifyOtp,
  createVerifiedSignupUser,
  OtpFlowType,
} from "../services/otpAuthService";
import { sendAuthResponse } from "../services/authTokenService";
import logger from "../utils/logger";

function flowFromBody(type: unknown): OtpFlowType {
  if (type === "signup" || type === "login" || type === "forgot_password") {
    return type;
  }
  throw new AppError(
    "Invalid type. Use signup, login, or forgot_password.",
    400,
  );
}

/** POST /api/auth/send-otp */
export const postSendOtp = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const flow = flowFromBody(req.body.type);
    const email = String(req.body.email || "").trim();

    try {
      if (flow === "signup") {
        const { name, password, phone } = req.body;
        await sendOtp({
          flow,
          email,
          signup: {
            name: String(name || "").trim(),
            email,
            password: String(password || ""),
            phone: String(phone || "").replace(/\D/g, ""),
          },
        });
      } else {
        await sendOtp({ flow, email });
      }
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode) {
        return next(new AppError(err.message, err.statusCode));
      }
      logger.error(`send-otp failed: ${err.message}`);
      return next(
        new AppError(
          "Could not send verification email. Please try again shortly.",
          503,
        ),
      );
    }

    const msg =
      flow === "forgot_password" ?
        "If an account exists for this email, you will receive a code shortly."
      : "Verification code sent to your email.";
    sendSuccess(res, { type: flow }, msg);
  },
);

/** POST /api/auth/resend-otp */
export const postResendOtp = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const flow = flowFromBody(req.body.type);
    const email = String(req.body.email || "").trim();

    try {
      await resendOtp({ flow, email });
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode) {
        return next(new AppError(err.message, err.statusCode));
      }
      logger.error(`resend-otp failed: ${err.message}`);
      return next(
        new AppError(
          "Could not resend the code. Please try again shortly.",
          503,
        ),
      );
    }

    const msg =
      flow === "forgot_password" ?
        "If an account exists for this email, you will receive a code shortly."
      : "A new verification code was sent to your email.";
    sendSuccess(res, { type: flow }, msg);
  },
);

/** POST /api/auth/verify-otp */
export const postVerifyOtp = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const flow = flowFromBody(req.body.type);
    const email = String(req.body.email || "").trim();
    const otp = String(req.body.otp || "").trim();

    const result = await verifyOtp({ flow, email, otp });
    if (!result.ok) {
      return next(new AppError(result.message, result.statusCode));
    }

    if (result.flow === "signup") {
      const { signupPayload, email: emailLower } = result;
      const user = await createVerifiedSignupUser(emailLower, signupPayload);
      await sendAuthResponse(res, user, 201);
      return;
    }

    if (result.flow === "login") {
      await sendAuthResponse(res, result.user, 200);
      return;
    }

    /* forgot_password — code is valid; client proceeds to reset-password */
    sendSuccess(res, { verified: true }, "Code verified. You can set a new password.");
  },
);
