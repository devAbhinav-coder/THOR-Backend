import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Request, Response, NextFunction } from "express";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User";
import AuthOtp from "../models/AuthOtp";
import RefreshToken from "../models/RefreshToken";
import AppError from "../utils/AppError";
import catchAsync from "../utils/catchAsync";
import { AuthRequest } from "../types";
import logger from "../utils/logger";
import { emailTemplates, sendEmailNow } from "../services/emailService";
import { enqueueEmail } from "../queues/emailQueue";
import {
  sendAuthResponse,
  hashToken,
  clearTokenCookies,
  revokeRefreshByRawCookie,
} from "../services/authTokenService";
import { assertRefreshAllowed } from "../services/refreshRateLimiter";
import { sendSuccess } from "../utils/response";
import { writeAdminAudit } from "../services/adminAuditService";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const googleClient =
  process.env.GOOGLE_CLIENT_ID ?
    new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

/** Try SMTP immediately so welcome mail is not only queued (queue worker / auth can fail silently). */
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

async function issueOtpCode(): Promise<{ plain: string; hash: string }> {
  const plain = String(crypto.randomInt(100000, 1000000));
  const hash = await bcrypt.hash(plain, 10);
  return { plain, hash };
}

/** Step 1: collect details & send email OTP (account created only after verify). */
export const signupStart = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, password, phone } = req.body;
    const emailLower = email.toLowerCase().trim();

    const existing = await User.findOne({ email: emailLower });
    if (existing) {
      return next(
        new AppError("An account with this email already exists.", 409),
      );
    }

    const { plain, hash } = await issueOtpCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await AuthOtp.findOneAndUpdate(
      { email: emailLower, purpose: "signup" },
      {
        email: emailLower,
        purpose: "signup",
        codeHash: hash,
        expiresAt,
        attempts: 0,
        signupPayload: { name, phone, password },
      },
      { upsert: true, new: true, runValidators: true },
    );

    const tpl = emailTemplates.otpSignup(name, plain);
    await enqueueEmail({
      to: emailLower,
      subject: tpl.subject,
      html: tpl.html,
    });

    sendSuccess(res, {}, "Verification code sent to your email.");
  },
);

/** Step 2: verify OTP and create user. */
export const signupVerify = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, otp } = req.body;
    const emailLower = email.toLowerCase().trim();

    const doc = await AuthOtp.findOne({
      email: emailLower,
      purpose: "signup",
    });

    if (!doc || doc.expiresAt.getTime() < Date.now()) {
      return next(new AppError("Invalid or expired verification code.", 400));
    }
    if (doc.attempts >= MAX_OTP_ATTEMPTS) {
      return next(
        new AppError("Too many attempts. Please request a new code.", 429),
      );
    }

    const ok = await bcrypt.compare(String(otp), doc.codeHash);
    if (!ok) {
      await AuthOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
      return next(new AppError("Invalid verification code.", 400));
    }

    const payload = doc.signupPayload;
    if (!payload?.name || !payload?.password) {
      return next(
        new AppError("Signup session invalid. Please start again.", 400),
      );
    }

    const user = await User.create({
      name: payload.name,
      email: emailLower,
      password: payload.password,
      phone: payload.phone || undefined,
      emailVerified: true,
      addresses: [],
    });

    await AuthOtp.deleteOne({ _id: doc._id });

    await deliverWelcomeEmail(payload.name, emailLower);
    user.set("welcomeEmailAt", new Date());
    await user.save({ validateModifiedOnly: true });

    await sendAuthResponse(res, user, 201);
  },
);

export const login = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password +googleId");
    if (!user) {
      await writeAdminAudit(req, "auth.login.failed", {
        reason: "user_not_found",
        email: String(email || "").toLowerCase(),
      });
      return next(new AppError("Invalid Credentials", 401));
    }

    if (user.googleId) {
      return next(
        new AppError(
          "This account uses Google sign-in. Please use Sign in with Google.",
          401,
        ),
      );
    }

    if (!(await user.comparePassword(password))) {
      await writeAdminAudit(
        req,
        "auth.login.failed",
        { reason: "wrong_password", email: user.email },
        String(user._id),
        String(user._id),
      );
      return next(new AppError("Invalid Credentials", 401));
    }

    if (!user.isActive) {
      await writeAdminAudit(
        req,
        "auth.login.failed",
        { reason: "inactive_user", email: user.email },
        String(user._id),
        String(user._id),
      );
      return next(
        new AppError(
          "Your account has been deactivated. Please contact support.",
          401,
        ),
      );
    }

    if (user.emailVerified === false) {
      await writeAdminAudit(
        req,
        "auth.login.failed",
        { reason: "email_not_verified", email: user.email },
        String(user._id),
        String(user._id),
      );
      return next(
        new AppError("Please verify your email before signing in.", 401),
      );
    }

    await sendAuthResponse(res, user, 200);
  },
);

export const refresh = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const raw = req.cookies?.refreshToken as string | undefined;
    if (!raw || raw === "loggedout") {
      return next(new AppError("Session expired. Please sign in again.", 401));
    }

    const doc = await RefreshToken.findOne({
      tokenHash: hashToken(raw),
      expiresAt: { $gt: new Date() },
    });

    if (!doc || doc.revokedAt) {
      return next(new AppError("Session expired. Please sign in again.", 401));
    }

    const user = await User.findById(doc.user);
    if (!user || !user.isActive) {
      return next(new AppError("Session expired. Please sign in again.", 401));
    }

    await assertRefreshAllowed(
      String(user._id),
      req.ip || req.socket.remoteAddress || "unknown",
    );

    await RefreshToken.updateOne(
      { _id: doc._id },
      { $set: { revokedAt: new Date() } },
    );
    await sendAuthResponse(res, user, 200);
  },
);

export const forgotPassword = catchAsync(
  async (req: Request, res: Response) => {
    const { email } = req.body;
    const emailLower = email.toLowerCase().trim();

    const user = await User.findOne({ email: emailLower }).select("+googleId");
    const generic = {
      status: "success" as const,
      message:
        "If an account exists for this email, you will receive a reset code shortly.",
    };

    if (!user || user.googleId) {
      sendSuccess(res, {}, generic.message);
      return;
    }

    const { plain, hash } = await issueOtpCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await AuthOtp.findOneAndUpdate(
      { email: emailLower, purpose: "password_reset" },
      {
        email: emailLower,
        purpose: "password_reset",
        codeHash: hash,
        expiresAt,
        attempts: 0,
      },
      { upsert: true, new: true },
    );

    const tpl = emailTemplates.otpPasswordReset(user.name, plain);
    await enqueueEmail({
      to: emailLower,
      subject: tpl.subject,
      html: tpl.html,
    });

    sendSuccess(res, {}, generic.message);
    return;
  },
);

export const resetPassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, otp, newPassword } = req.body;
    const emailLower = email.toLowerCase().trim();

    const doc = await AuthOtp.findOne({
      email: emailLower,
      purpose: "password_reset",
    });
    if (!doc || doc.expiresAt.getTime() < Date.now()) {
      return next(new AppError("Invalid or expired code.", 400));
    }
    if (doc.attempts >= MAX_OTP_ATTEMPTS) {
      return next(new AppError("Too many attempts. Request a new code.", 429));
    }

    const ok = await bcrypt.compare(String(otp), doc.codeHash);
    if (!ok) {
      await AuthOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
      return next(new AppError("Invalid verification code.", 400));
    }

    const user = await User.findOne({ email: emailLower }).select(
      "+password +googleId",
    );
    if (!user || user.googleId) {
      return next(new AppError("Invalid or expired code.", 400));
    }

    user.password = newPassword;
    await user.save();
    await AuthOtp.deleteOne({ _id: doc._id });
    await RefreshToken.deleteMany({ user: user._id });

    await sendAuthResponse(res, user, 200);
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
    const email = payload.email.toLowerCase();
    const name = payload.name || email.split("@")[0];

    let user = await User.findOne({ googleId: sub }).select(
      "+googleId +password +welcomeEmailAt",
    );
    let isNewGoogleSignup = false;

    if (!user) {
      const byEmail = await User.findOne({ email }).select(
        "+googleId +password +welcomeEmailAt",
      );
      if (byEmail) {
        if (byEmail.googleId && byEmail.googleId !== sub) {
          return next(
            new AppError(
              "This email is linked to another Google account.",
              409,
            ),
          );
        }
        const hadGoogleId = Boolean(byEmail.googleId);
        const welcomeMissing = !byEmail.welcomeEmailAt;
        const accountAgeMs = Date.now() - new Date(byEmail.createdAt).getTime();
        const veryNewAccount = accountAgeMs < 5 * 60 * 1000;

        byEmail.googleId = sub;
        await byEmail.save();
        user = byEmail;

        if (!hadGoogleId && welcomeMissing && veryNewAccount) {
          await deliverWelcomeEmail(user.name, user.email);
          user.set("welcomeEmailAt", new Date());
          await user.save({ validateModifiedOnly: true });
        }
      } else {
        const randomPassword = crypto.randomBytes(32).toString("hex");
        const safeName = (name || "").trim() || email.split("@")[0];
        user = await User.create({
          name: safeName.slice(0, 50),
          email,
          password: randomPassword,
          googleId: sub,
          emailVerified: true,
          addresses: [],
        });
        isNewGoogleSignup = true;
      }
    }

    if (!user.isActive) {
      return next(
        new AppError(
          "Your account has been deactivated. Please contact support.",
          401,
        ),
      );
    }

    if (isNewGoogleSignup) {
      await deliverWelcomeEmail(user.name, user.email);
      user.set("welcomeEmailAt", new Date());
      await user.save({ validateModifiedOnly: true });
    }

    await sendAuthResponse(res, user, 200);
  },
);

export const logout = catchAsync(async (req: Request, res: Response) => {
  await revokeRefreshByRawCookie(
    req.cookies?.refreshToken as string | undefined,
  );
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
    const allowedFields = ["name", "phone"];
    allowedFields.forEach((field) => {
      if (req.body[field]) filteredBody[field] = req.body[field];
    });

    if (req.file) {
      filteredBody.avatar =
        (req.file as Express.Multer.File & { path: string }).path ||
        req.file.originalname;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user!._id,
      filteredBody,
      {
        new: true,
        runValidators: true,
      },
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
    await sendAuthResponse(res, user, 200);
  },
);

export const addAddress = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const {
      name,
      phone,
      street,
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

    if (user.addresses.length === 0) {
      req.body.isDefault = true;
    }

    user.addresses.push({
      name,
      phone,
      street,
      city,
      state,
      pincode,
      country: country || "India",
      label: label || "Home",
      isDefault: isDefault || false,
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
    await revokeRefreshByRawCookie(
      req.cookies?.refreshToken as string | undefined,
    );
    clearTokenCookies(res);

    sendSuccess(res, {}, "Your account has been deleted successfully.");
  },
);
