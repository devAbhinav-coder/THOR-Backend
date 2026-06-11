import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { OAuth2Client } from "google-auth-library";
import mongoose from "mongoose";
import User from "../models/User";
import AppError from "../types/utils/AppError";
import catchAsync from "../types/utils/catchAsync";
import { AuthRequest } from "../types";
import logger from "../types/utils/logger";
import { emailTemplates, sendEmailNow } from "../services/emailService";
import { enqueueEmail } from "../queues/emailQueue";
import {
  sendOtp as sendOtpUnified,
  verifyOtp,
  createVerifiedSignupUser,
} from "../services/otpAuthService";
import RefreshToken from "../models/RefreshToken";
import {
  sendAuthResponse,
  revokeRefreshByRawCookie,
  clearTokenCookies,
  readRefreshTokenFromRequest,
  rotateRefreshToken,
  hashToken,
} from "../services/authTokenService";
import { assertRefreshAllowed } from "../services/refreshRateLimiter";
import { sendSuccess } from "../types/utils/response";
import { writeAdminAudit } from "../services/adminAuditService";
import { removeOfflineCustomerByEmail } from "../services/offlineCustomerService";
import {
  resetPasswordWithOtp,
  resetPasswordWithToken,
} from "../services/passwordResetService";
import { emitAuthEvent } from "../services/authEventService";
import { authRequestMeta, normalizeUnicodeText } from "../auth/authNormalize";
import { LOGIN_FAILED_GENERIC, RESET_GENERIC } from "../auth/authErrors";
import { securityLog } from "../types/utils/securityLog";

const googleClient =
  process.env.GOOGLE_CLIENT_ID ?
    new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

async function deliverWelcomeEmail(
  displayName: string,
  emailLower: string,
): Promise<void> {
  const welcome = emailTemplates.welcome(displayName);
  const payload = {
    to: emailLower,
    subject: welcome.subject,
    html: welcome.html,
  };
  try {
    await sendEmailNow(payload);
  } catch (err) {
    logger.warn(
      `Welcome email direct send failed (${emailLower}): ${(err as Error).message}; retry via queue`,
    );
    await enqueueEmail(payload);
  }
}

function sendWelcomeEmailInBackground(
  displayName: string,
  emailLower: string,
): void {
  void (async () => {
    try {
      await deliverWelcomeEmail(displayName, emailLower);
      await User.updateOne(
        { email: emailLower, welcomeEmailAt: { $exists: false } },
        { $set: { welcomeEmailAt: new Date() } },
      );
    } catch (err) {
      logger.warn(
        `Welcome email background send failed (${emailLower}): ${(err as Error).message}`,
      );
    }
  })();
}

function mapServiceError(
  e: unknown,
  next: NextFunction,
  fallback: string,
): void {
  const err = e as Error & { statusCode?: number };
  if (err.statusCode) {
    return next(new AppError(err.message, err.statusCode));
  }
  logger.error(`${fallback}: ${err.message}`);
  return next(new AppError(fallback, 503));
}

export const signupStart = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, password, phone } = req.body;
    try {
      await sendOtpUnified({
        flow: "signup",
        email,
        signup: { name, email, password, phone },
      });
    } catch (e) {
      return mapServiceError(
        e,
        next,
        "Could not send verification email. Please try again shortly.",
      );
    }
    sendSuccess(res, {}, "Verification code sent to your email.");
  },
);

export const signupVerify = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, otp } = req.body;
    const { ip } = authRequestMeta(req);

    const result = await verifyOtp({
      flow: "signup",
      email,
      otp: String(otp),
      ip,
    });
    if (!result.ok) {
      return next(new AppError(result.message, result.statusCode));
    }
    if (result.flow !== "signup") {
      return next(new AppError("Invalid verification response.", 500));
    }

    const user = await createVerifiedSignupUser(
      result.email,
      result.signupPayload,
    );
    emitAuthEvent({
      type: "AUTH_SIGNUP_COMPLETED",
      userId: String(user._id),
      email: user.email,
      req,
    });
    await sendAuthResponse(res, user, 201, req);
  },
);

export const login = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password +googleId");
    if (!user) {
      await writeAdminAudit(req, "auth.login.failed", {
        reason: "user_not_found",
        email,
      });
      securityLog("auth.failure", { reason: "user_not_found", email });
      return next(new AppError(LOGIN_FAILED_GENERIC, 401));
    }

    if (user.googleId) {
      await writeAdminAudit(
        req,
        "auth.login.failed",
        { reason: "google_only_account", email: user.email },
        String(user._id),
        String(user._id),
      );
      return next(new AppError(LOGIN_FAILED_GENERIC, 401));
    }

    if (!(await user.comparePassword(password))) {
      await writeAdminAudit(
        req,
        "auth.login.failed",
        { reason: "wrong_password", email: user.email },
        String(user._id),
        String(user._id),
      );
      securityLog("auth.failure", {
        reason: "wrong_password",
        userId: String(user._id),
      });
      return next(new AppError(LOGIN_FAILED_GENERIC, 401));
    }

    if (!user.isActive || user.emailVerified === false) {
      await writeAdminAudit(
        req,
        "auth.login.failed",
        {
          reason: user.isActive ? "email_not_verified" : "inactive_user",
          email: user.email,
        },
        String(user._id),
        String(user._id),
      );
      return next(new AppError(LOGIN_FAILED_GENERIC, 401));
    }

    emitAuthEvent({
      type: "AUTH_LOGIN_SUCCESS",
      userId: String(user._id),
      email: user.email,
      req,
    });
    await sendAuthResponse(res, user, 200, req);
  },
);

export const refresh = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const raw = readRefreshTokenFromRequest(req);
    if (!raw) {
      return next(new AppError("Session expired. Please sign in again.", 401));
    }

    const doc = await RefreshToken.findOne({ tokenHash: hashToken(raw) });

    if (doc) {
      await assertRefreshAllowed(String(doc.user), authRequestMeta(req).ip);
    }

    try {
      await rotateRefreshToken(req, res);
    } catch (e) {
      if (e instanceof AppError) return next(e);
      return next(new AppError("Session expired. Please sign in again.", 401));
    }
  },
);

export const forgotPassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email } = req.body;
    try {
      await sendOtpUnified({ flow: "forgot_password", email });
    } catch (e) {
      return mapServiceError(
        e,
        next,
        "Could not send reset email. Please try again shortly.",
      );
    }
    sendSuccess(res, {}, RESET_GENERIC);
  },
);

export const resetPassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as {
      resetToken?: string;
      email?: string;
      otp?: string;
      newPassword: string;
    };

    let user;
    if (body.resetToken) {
      user = await resetPasswordWithToken(
        body.resetToken,
        body.newPassword,
        req,
      );
    } else if (body.email && body.otp) {
      user = await resetPasswordWithOtp(
        body.email,
        String(body.otp),
        body.newPassword,
        req,
      );
    } else {
      return next(
        new AppError(
          "Reset token or email and verification code required.",
          400,
        ),
      );
    }

    await sendAuthResponse(res, user, 200, req);
  },
);

export const googleAuth = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!googleClient || !process.env.GOOGLE_CLIENT_ID) {
      return next(new AppError("Google sign-in is not configured.", 503));
    }

    const { credential } = req.body as { credential?: string };
    if (!credential) {
      return next(new AppError("Google credential is required.", 400));
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) {
      return next(new AppError("Google email not verified.", 401));
    }

    const sub = payload.sub;
    const email = payload.email.toLowerCase().trim();
    const name = payload.name || email.split("@")[0];
    const picture =
      typeof payload.picture === "string" && payload.picture.trim().length > 0 ?
        payload.picture.trim()
      : undefined;

    const session = await mongoose.startSession();
    let resolvedUser: InstanceType<typeof User> | null = null;
    let isNewGoogleSignup = false;

    try {
      await session.withTransaction(async () => {
        let found: InstanceType<typeof User> | null = await User.findOne({
          googleId: sub,
        })
          .select("+googleId +password +welcomeEmailAt")
          .session(session);

        if (!found) {
          const byEmail = await User.findOne({ email })
            .select("+googleId +password +welcomeEmailAt")
            .session(session);

          if (byEmail) {
            if (byEmail.googleId && byEmail.googleId !== sub) {
              throw new AppError(
                "This email is linked to another Google account.",
                409,
              );
            }
            const hadGoogleId = Boolean(byEmail.googleId);
            const welcomeMissing = !byEmail.welcomeEmailAt;
            const accountAgeMs =
              Date.now() - new Date(byEmail.createdAt).getTime();
            const veryNewAccount = accountAgeMs < 5 * 60 * 1000;

            byEmail.googleId = sub;
            if (byEmail.offlineLead) byEmail.offlineLead = false;
            if (
              picture &&
              (!byEmail.avatar || !String(byEmail.avatar).trim())
            ) {
              byEmail.avatar = picture;
            }
            await byEmail.save({ session });
            found = byEmail;

            if (!hadGoogleId && welcomeMissing && veryNewAccount) {
              sendWelcomeEmailInBackground(found.name, found.email);
            }
          } else {
            const randomPassword = crypto.randomBytes(32).toString("hex");
            const safeName = (name || "").trim() || email.split("@")[0];
            const created = await User.create(
              [
                {
                  name: safeName.slice(0, 50),
                  email,
                  password: randomPassword,
                  googleId: sub,
                  emailVerified: true,
                  ...(picture ? { avatar: picture } : {}),
                  addresses: [],
                },
              ],
              { session },
            );
            found = created[0]!;
            isNewGoogleSignup = true;
          }
        } else if (picture && (!found.avatar || !String(found.avatar).trim())) {
          found.avatar = picture;
          await found.save({ session });
        }

        resolvedUser = found;
      });
    } finally {
      await session.endSession();
    }

    if (!resolvedUser) {
      return next(new AppError("Google sign-in failed.", 500));
    }
    const user: InstanceType<typeof User> = resolvedUser;

    if (user.isActive === false) {
      return next(
        new AppError(
          "Your account has been deactivated. Please contact support.",
          401,
        ),
      );
    }

    await removeOfflineCustomerByEmail(email);

    if (isNewGoogleSignup) {
      sendWelcomeEmailInBackground(user.name, user.email);
      emitAuthEvent({
        type: "AUTH_SIGNUP_COMPLETED",
        userId: String(user._id),
        email: user.email,
        meta: { provider: "google" },
        req,
      });
    } else {
      emitAuthEvent({
        type: "AUTH_LOGIN_SUCCESS",
        userId: String(user._id),
        email: user.email,
        meta: { provider: "google" },
        req,
      });
    }

    await sendAuthResponse(res, user, 200, req);
  },
);

export const logout = catchAsync(async (req: Request, res: Response) => {
  await revokeRefreshByRawCookie(readRefreshTokenFromRequest(req), true);
  clearTokenCookies(res);
  sendSuccess(res, {}, "Logged out successfully");
});

export const getMe = catchAsync(async (req: AuthRequest, res: Response) => {
  sendSuccess(res, { user: req.user });
});

export const updateMe = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.body.password) {
      return next(
        new AppError(
          "This route is not for password updates. Please use /update-password.",
          400,
        ),
      );
    }

    const filteredBody: Record<string, unknown> = {};
    if (req.body.name) {
      filteredBody.name = normalizeUnicodeText(String(req.body.name), 50);
    }
    if (req.body.phone !== undefined && req.body.phone !== "") {
      filteredBody.phone = req.body.phone;
    }

    if (req.file) {
      filteredBody.avatar =
        (req.file as Express.Multer.File & { path: string }).path ||
        req.file.originalname;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user!._id,
      filteredBody,
      { new: true, runValidators: true },
    );

    sendSuccess(res, { user: updatedUser });
  },
);

export const updatePassword = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user!._id).select("+password");
    if (!user) return next(new AppError("User not found", 404));

    if (!(await user.comparePassword(currentPassword))) {
      return next(new AppError("Your current password is incorrect.", 401));
    }

    user.password = newPassword;
    await user.save();

    await RefreshToken.deleteMany({ user: user._id });
    await sendAuthResponse(res, user, 200, req);
  },
);

export const addAddress = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const {
      name,
      phone,
      house,
      street,
      landmark,
      city,
      state,
      pincode,
      country,
      label,
      isDefault,
    } = req.body;

    const user = await User.findById(req.user!._id);
    if (!user) throw new AppError("User not found", 404);

    if (isDefault) {
      user.addresses.forEach((addr) => (addr.isDefault = false));
    }

    const defaultFlag = user.addresses.length === 0 ? true : Boolean(isDefault);

    user.addresses.push({
      name: normalizeUnicodeText(String(name), 80),
      phone,
      house: house ? normalizeUnicodeText(String(house), 120) : undefined,
      street: normalizeUnicodeText(String(street), 200),
      landmark:
        landmark ? normalizeUnicodeText(String(landmark), 160) : undefined,
      city: normalizeUnicodeText(String(city), 80),
      state: normalizeUnicodeText(String(state), 80),
      pincode,
      country: country || "India",
      label: label || "Home",
      isDefault: defaultFlag,
    });
    await user.save();

    sendSuccess(res, { addresses: user.addresses });
  },
);

export const removeAddress = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const user = await User.findById(req.user!._id);
    if (!user) throw new AppError("User not found", 404);

    user.addresses = user.addresses.filter(
      (addr) => addr._id?.toString() !== req.params.addressId,
    );
    await user.save();

    sendSuccess(res, { addresses: user.addresses });
  },
);

export const deleteMe = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = await User.findById(req.user!._id);
    if (!user) return next(new AppError("User not found", 404));

    user.isActive = false;
    await user.save();

    await RefreshToken.deleteMany({ user: user._id });
    await revokeRefreshByRawCookie(readRefreshTokenFromRequest(req), true);
    clearTokenCookies(res);

    sendSuccess(res, {}, "Your account has been deleted successfully.");
  },
);
