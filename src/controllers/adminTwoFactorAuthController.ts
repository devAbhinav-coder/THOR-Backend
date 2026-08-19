import { Request, Response, NextFunction } from "express";
import User from "../models/User";
import catchAsync from "../types/utils/catchAsync";
import AppError from "../types/utils/AppError";
import {
  verifyAdmin2FAPendingToken,
  verifyAdminSecondFactor,
  signAdmin2FAPendingToken,
} from "../services/adminTwoFactorService";
import { sendAuthResponse } from "../services/authTokenService";
import { writeAdminAudit } from "../services/adminAuditService";
import { emitAuthEvent } from "../services/authEventService";

export const verifyAdminTwoFactorLogin = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { pendingToken, code } = req.body as {
      pendingToken?: string;
      code?: string;
    };
    if (!pendingToken?.trim() || !code?.trim()) {
      return next(new AppError("Pending session and code are required.", 400));
    }

    let userId: string;
    try {
      userId = verifyAdmin2FAPendingToken(pendingToken.trim());
    } catch {
      return next(
        new AppError("Two-factor session expired. Please sign in again.", 401),
      );
    }

    const user = await User.findById(userId);
    if (!user || user.role !== "admin" || !user.isActive) {
      return next(new AppError("Invalid admin session.", 401));
    }
    if (!user.adminTwoFactorEnabled) {
      return next(new AppError("Two-factor authentication is not enabled.", 400));
    }

    try {
      await verifyAdminSecondFactor(userId, code.trim());
    } catch (e) {
      await writeAdminAudit(req, "auth.admin_2fa.failed", {
        userId,
        email: user.email,
      }, userId, userId);
      if (e instanceof AppError) return next(e);
      return next(new AppError("Invalid authenticator or backup code.", 401));
    }

    emitAuthEvent({
      type: "AUTH_LOGIN_SUCCESS",
      userId: String(user._id),
      email: user.email,
      req,
    });
    await writeAdminAudit(
      req,
      "auth.admin_2fa.verified",
      { email: user.email },
      String(user._id),
      String(user._id),
    );

    await sendAuthResponse(res, user, 200, req, { admin2faVerified: true });
  },
);

/** After password check — admin with 2FA enabled gets a pending token instead of cookies. */
export async function respondAdminLoginOrTwoFactor(
  req: Request,
  res: Response,
  user: InstanceType<typeof User>,
): Promise<void> {
  if (user.role !== "admin" || !user.adminTwoFactorEnabled) {
    await sendAuthResponse(res, user, 200, req);
    return;
  }

  res.status(200).json({
    status: "success",
    message: "Two-factor authentication required",
    data: {
      requiresAdmin2FA: true,
      pendingToken: signAdmin2FAPendingToken(String(user._id)),
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  });
}
