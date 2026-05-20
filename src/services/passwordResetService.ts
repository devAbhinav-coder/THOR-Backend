import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import AuthOtp from "../models/AuthOtp";
import User from "../models/User";
import RefreshToken from "../models/RefreshToken";
import AppError from "../utils/AppError";
import { consumePasswordResetToken } from "./passwordResetTokenService";
import { removeOfflineCustomerByEmail } from "./offlineCustomerService";
import { emitAuthEvent } from "./authEventService";
import { OTP_INVALID, OTP_TOO_MANY } from "../auth/authErrors";
import { MAX_OTP_VERIFY_ATTEMPTS } from "./otpAuthService";
import { normalizeEmail, normalizeOtp } from "../auth/authNormalize";
import type { Request } from "express";

export async function resetPasswordWithToken(
  resetToken: string,
  newPassword: string,
  req?: Request,
): Promise<InstanceType<typeof User>> {
  const consumed = await consumePasswordResetToken(resetToken);
  if (!consumed) {
    throw new AppError("Reset link expired. Please request a new code.", 400);
  }
  return applyPasswordReset(consumed.email, newPassword, req);
}

/** Legacy one-step reset using email + OTP (still supported). */
export async function resetPasswordWithOtp(
  email: string,
  otp: string,
  newPassword: string,
  req?: Request,
): Promise<InstanceType<typeof User>> {
  const emailLower = normalizeEmail(email);
  const otpNorm = normalizeOtp(otp);

  const doc = await AuthOtp.findOne({
    email: emailLower,
    purpose: "password_reset",
    consumedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });

  if (!doc) {
    throw new AppError(OTP_INVALID, 400);
  }
  if (doc.attempts >= MAX_OTP_VERIFY_ATTEMPTS) {
    throw new AppError(OTP_TOO_MANY, 429);
  }

  const match = await bcrypt.compare(otpNorm, doc.codeHash);
  if (!match) {
    await AuthOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
    throw new AppError("Invalid verification code.", 400);
  }

  const consumed = await AuthOtp.findOneAndDelete({
    _id: doc._id,
    consumedAt: { $exists: false },
  });
  if (!consumed) {
    throw new AppError("This code was already used. Request a new one.", 400);
  }

  return applyPasswordReset(emailLower, newPassword, req);
}

async function applyPasswordReset(
  emailLower: string,
  newPassword: string,
  req?: Request,
): Promise<InstanceType<typeof User>> {
  const session = await mongoose.startSession();
  let updatedUser: InstanceType<typeof User> | null = null;
  try {
    await session.withTransaction(async () => {
      const u = await User.findOne({ email: emailLower })
        .select("+password +googleId")
        .session(session);
      if (!u || u.googleId) {
        throw new AppError(OTP_INVALID, 400);
      }
      u.password = newPassword;
      u.offlineLead = false;
      await u.save({ session });
      await RefreshToken.deleteMany({ user: u._id }).session(session);
      updatedUser = u;
    });
  } finally {
    await session.endSession();
  }

  if (!updatedUser) {
    throw new AppError(OTP_INVALID, 400);
  }
  const user: InstanceType<typeof User> = updatedUser;

  await removeOfflineCustomerByEmail(emailLower);
  emitAuthEvent({
    type: "PASSWORD_RESET_COMPLETED",
    userId: String(user._id),
    email: emailLower,
    req,
  });

  return user;
}
