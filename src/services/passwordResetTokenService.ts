import crypto from "crypto";
import AuthOtp from "../models/AuthOtp";
import { hashToken } from "./authTokenService";

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

export function issuePasswordResetToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  return { raw, hash, expiresAt };
}

/**
 * After forgot-password OTP is verified, store a short-lived reset token on the OTP doc.
 * Password reset consumes this token (preferred) or legacy OTP in one shot.
 */
export async function attachResetTokenToOtp(
  emailLower: string,
): Promise<{ resetToken: string; expiresAt: Date } | null> {
  const { raw, hash, expiresAt } = issuePasswordResetToken();
  const doc = await AuthOtp.findOneAndUpdate(
    {
      email: emailLower,
      purpose: "password_reset",
      consumedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        consumedAt: new Date(),
        resetTokenHash: hash,
        resetTokenExpiresAt: expiresAt,
      },
    },
    { new: true },
  );
  if (!doc) return null;
  return { resetToken: raw, expiresAt };
}

export async function consumePasswordResetToken(
  resetTokenRaw: string,
): Promise<{ email: string } | null> {
  const hash = hashToken(resetTokenRaw);
  const doc = await AuthOtp.findOneAndDelete({
    resetTokenHash: hash,
    resetTokenExpiresAt: { $gt: new Date() },
    purpose: "password_reset",
  });
  if (!doc) return null;
  return { email: doc.email };
}
