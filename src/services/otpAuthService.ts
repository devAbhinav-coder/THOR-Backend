import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import AuthOtp, { AuthOtpPurpose } from "../models/AuthOtp";
import User from "../models/User";
import { removeOfflineCustomerByEmail } from "./offlineCustomerService";
import { emailTemplates } from "./emailService";
import { deliverOtpEmail } from "./emailDeliveryService";
import { assertOtpSendAllowed, recordOtpSend } from "./otpRateLimitService";
import {
  assertOtpVerifyAllowed,
  clearOtpVerifyFailures,
  recordOtpVerifyFailure,
} from "./otpVerifyThrottleService";
import { enqueueEmail } from "../queues/emailQueue";
import { sendEmailNow } from "./emailService";
import { issuePasswordResetToken } from "./passwordResetTokenService";
import logger from "../utils/logger";
import { normalizeEmail, normalizeIndianPhone, normalizeOtp } from "../auth/authNormalize";
import { serviceError, OTP_INVALID, OTP_TOO_MANY } from "../auth/authErrors";

export type OtpFlowType = "signup" | "login" | "forgot_password";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
export const RESEND_COOLDOWN_SEC = Math.ceil(RESEND_COOLDOWN_MS / 1000);
export const MAX_OTP_VERIFY_ATTEMPTS = 5;

export function getResendCooldownSeconds(lastSentAt: Date | undefined): number {
  if (!lastSentAt) return 0;
  const remaining = RESEND_COOLDOWN_MS - (Date.now() - new Date(lastSentAt).getTime());
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function mapFlowToPurpose(flow: OtpFlowType): AuthOtpPurpose {
  if (flow === "forgot_password") return "password_reset";
  return flow;
}

async function issueOtpCode(): Promise<{ plain: string; hash: string }> {
  const plain = String(crypto.randomInt(100000, 1000000));
  const hash = await bcrypt.hash(plain, 10);
  return { plain, hash };
}

function scheduleWelcomeEmail(
  userId: string,
  emailLower: string,
  name: string,
): void {
  const welcome = emailTemplates.welcome(name);
  const payload = {
    to: emailLower,
    subject: welcome.subject,
    html: welcome.html,
  };
  void (async () => {
    try {
      try {
        await sendEmailNow(payload);
      } catch (e) {
        logger.warn(
          `Welcome email direct send failed (${emailLower}): ${(e as Error).message}; retry via queue`,
        );
        await enqueueEmail(payload);
      }
      await User.updateOne(
        { _id: userId },
        { $set: { welcomeEmailAt: new Date() } },
      );
    } catch (e) {
      logger.error(
        `Welcome email pipeline failed (${emailLower}): ${(e as Error).message}`,
      );
    }
  })();
}

export async function createVerifiedSignupUser(
  emailLower: string,
  signupPayload: SignupOtpPayload,
): Promise<InstanceType<typeof User>> {
  const session = await mongoose.startSession();
  try {
    let createdUser: InstanceType<typeof User> | null = null;
    await session.withTransaction(async () => {
      const claim = await User.findOne({
        email: emailLower,
        offlineLead: true,
      })
        .select("+password")
        .session(session);

      if (claim) {
        claim.name = signupPayload.name.trim().slice(0, 50);
        claim.password = signupPayload.password;
        if (signupPayload.phone?.trim()) {
          const p10 = normalizeIndianPhone(signupPayload.phone);
          if (/^[6-9]\d{9}$/.test(p10)) {
            claim.phone = p10;
          }
        }
        claim.offlineLead = false;
        claim.emailVerified = true;
        await claim.save({ session });
        createdUser = claim;
      } else {
        const existing = await User.findOne({ email: emailLower })
          .select("_id offlineLead")
          .session(session);
        if (existing && !existing.offlineLead) {
          throw serviceError("An account with this email already exists.", 409);
        }
        const created = await User.create(
          [
            {
              name: signupPayload.name,
              email: emailLower,
              password: signupPayload.password,
              phone: signupPayload.phone || undefined,
              emailVerified: true,
              addresses: [],
            },
          ],
          { session },
        );
        createdUser = created[0]!;
      }
    });
    if (!createdUser) {
      throw serviceError("Could not create account.", 500);
    }
    const user: InstanceType<typeof User> = createdUser;
    await removeOfflineCustomerByEmail(emailLower);
    scheduleWelcomeEmail(String(user._id), emailLower, signupPayload.name);
    return user;
  } finally {
    await session.endSession();
  }
}

export type SignupOtpBody = {
  name: string;
  email: string;
  password: string;
  phone: string;
};

export type SignupOtpPayload = {
  name: string;
  password: string;
  phone?: string;
};

export type VerifyOtpResult =
  | {
      ok: true;
      flow: "signup";
      email: string;
      signupPayload: SignupOtpPayload;
    }
  | { ok: true; flow: "login"; user: InstanceType<typeof User> }
  | { ok: true; flow: "forgot_password"; resetToken: string }
  | { ok: false; message: string; statusCode: number; retryAfter?: number };

export async function sendOtp(params: {
  flow: OtpFlowType;
  email: string;
  signup?: SignupOtpBody;
}): Promise<void> {
  const emailLower = normalizeEmail(params.email);
  const purpose = mapFlowToPurpose(params.flow);

  const existing = await AuthOtp.findOne({ email: emailLower, purpose }).lean();
  if (
    existing?.lastSentAt &&
    Date.now() - new Date(existing.lastSentAt).getTime() < RESEND_COOLDOWN_MS
  ) {
    const waitSec = getResendCooldownSeconds(existing.lastSentAt);
    throw serviceError(
      `Please wait ${waitSec}s before requesting another code.`,
      429,
      waitSec,
    );
  }

  if (params.flow === "signup") {
    const s = params.signup;
    if (!s?.name || !s.password || !s.phone) {
      throw serviceError("Name, password, and phone are required for signup.", 400);
    }
    const taken = await User.findOne({ email: emailLower }).select("offlineLead").lean();
    if (taken && !taken.offlineLead) {
      throw serviceError("An account with this email already exists.", 409);
    }
  } else if (params.flow === "login") {
    const user = await User.findOne({ email: emailLower }).select(
      "+googleId emailVerified isActive",
    );
    if (!user) {
      throw serviceError("No password account found for this email.", 404);
    }
    if (user.googleId) {
      throw serviceError(
        "This account uses Google sign-in. Use Sign in with Google.",
        400,
      );
    }
    if (!user.isActive) {
      throw serviceError(
        "Your account has been deactivated. Please contact support.",
        403,
      );
    }
    if (user.emailVerified === false) {
      throw serviceError("Please verify your email before signing in.", 403);
    }
  } else if (params.flow === "forgot_password") {
    const user = await User.findOne({ email: emailLower }).select("+googleId").lean();
    if (!user || user.googleId) {
      logger.info(`Forgot-password OTP skipped (no eligible account): ${emailLower}`);
      return;
    }
  }

  await assertOtpSendAllowed(emailLower, params.flow);

  const { plain, hash } = await issueOtpCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
  const now = new Date();

  if (params.flow === "signup" && params.signup) {
    await AuthOtp.findOneAndUpdate(
      { email: emailLower, purpose: "signup" },
      {
        email: emailLower,
        purpose: "signup",
        codeHash: hash,
        expiresAt,
        attempts: 0,
        lastSentAt: now,
        $unset: { consumedAt: 1, resetTokenHash: 1, resetTokenExpiresAt: 1 },
        signupPayload: {
          name: params.signup.name,
          phone: params.signup.phone,
          password: params.signup.password,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    const tpl = emailTemplates.otpSignup(params.signup.name, plain);
    await recordOtpSend(emailLower, params.flow);
    await deliverOtpEmail({
      to: emailLower,
      subject: tpl.subject,
      html: tpl.html,
    });
    return;
  }

  if (params.flow === "login") {
    const user = await User.findOne({ email: emailLower }).lean();
    if (!user) throw serviceError("No password account found for this email.", 404);
    await AuthOtp.findOneAndUpdate(
      { email: emailLower, purpose: "login" },
      {
        email: emailLower,
        purpose: "login",
        codeHash: hash,
        expiresAt,
        attempts: 0,
        lastSentAt: now,
        $unset: { signupPayload: 1, consumedAt: 1, resetTokenHash: 1, resetTokenExpiresAt: 1 },
      },
      { upsert: true, new: true, runValidators: true },
    );
    const tpl = emailTemplates.otpLogin(user.name, plain);
    await recordOtpSend(emailLower, params.flow);
    await deliverOtpEmail({
      to: emailLower,
      subject: tpl.subject,
      html: tpl.html,
    });
    return;
  }

  const user = await User.findOne({ email: emailLower }).lean();
  if (!user || user.googleId) {
    return;
  }
  await AuthOtp.findOneAndUpdate(
    { email: emailLower, purpose: "password_reset" },
    {
      email: emailLower,
      purpose: "password_reset",
      codeHash: hash,
      expiresAt,
      attempts: 0,
      lastSentAt: now,
      $unset: { signupPayload: 1, consumedAt: 1, resetTokenHash: 1, resetTokenExpiresAt: 1 },
    },
    { upsert: true, new: true, runValidators: true },
  );
  const tpl = emailTemplates.otpPasswordReset(user.name, plain);
  await recordOtpSend(emailLower, params.flow);
  await deliverOtpEmail({
    to: emailLower,
    subject: tpl.subject,
    html: tpl.html,
  });
}

export async function resendOtp(params: {
  flow: OtpFlowType;
  email: string;
}): Promise<void> {
  const emailLower = normalizeEmail(params.email);

  if (params.flow === "signup") {
    const doc = await AuthOtp.findOne({ email: emailLower, purpose: "signup" });
    if (!doc?.signupPayload) {
      throw serviceError("No pending signup for this email. Please start again.", 400);
    }
    if (
      doc.lastSentAt &&
      Date.now() - new Date(doc.lastSentAt).getTime() < RESEND_COOLDOWN_MS
    ) {
      const waitSec = getResendCooldownSeconds(doc.lastSentAt);
      throw serviceError(
        `Please wait ${waitSec}s before requesting another code.`,
        429,
        waitSec,
      );
    }
    await assertOtpSendAllowed(emailLower, params.flow);
    const { plain, hash } = await issueOtpCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    const now = new Date();
    await AuthOtp.updateOne(
      { _id: doc._id, consumedAt: { $exists: false } },
      {
        $set: {
          codeHash: hash,
          expiresAt,
          attempts: 0,
          lastSentAt: now,
        },
        $unset: { resetTokenHash: 1, resetTokenExpiresAt: 1 },
      },
    );
    const name = (doc.signupPayload as SignupOtpPayload).name;
    const tpl = emailTemplates.otpSignup(name, plain);
    await recordOtpSend(emailLower, params.flow);
    await deliverOtpEmail({
      to: emailLower,
      subject: tpl.subject,
      html: tpl.html,
    });
    return;
  }

  await sendOtp({ flow: params.flow, email: emailLower });
}

/**
 * Atomic OTP verification: compare hash, consume once, prevent replay/races.
 */
export async function verifyOtp(params: {
  flow: OtpFlowType;
  email: string;
  otp: string;
  ip?: string;
}): Promise<VerifyOtpResult> {
  const emailLower = normalizeEmail(params.email);
  const purpose = mapFlowToPurpose(params.flow);
  const otpNorm = normalizeOtp(params.otp);
  const ip = params.ip || "unknown";

  await assertOtpVerifyAllowed(emailLower, params.flow, ip);

  const doc = await AuthOtp.findOne({
    email: emailLower,
    purpose,
    consumedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
    attempts: { $lt: MAX_OTP_VERIFY_ATTEMPTS },
  });

  if (!doc) {
    const exhausted = await AuthOtp.findOne({
      email: emailLower,
      purpose,
      consumedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
      attempts: { $gte: MAX_OTP_VERIFY_ATTEMPTS },
    }).lean();
    if (exhausted) {
      return { ok: false, message: OTP_TOO_MANY, statusCode: 429, retryAfter: RESEND_COOLDOWN_SEC };
    }
    return { ok: false, message: OTP_INVALID, statusCode: 400 };
  }

  const match = await bcrypt.compare(otpNorm, doc.codeHash);
  if (!match) {
    const bumped = await AuthOtp.findOneAndUpdate(
      {
        _id: doc._id,
        consumedAt: { $exists: false },
        attempts: { $lt: MAX_OTP_VERIFY_ATTEMPTS },
      },
      { $inc: { attempts: 1 } },
      { new: true },
    );
    await recordOtpVerifyFailure(emailLower, params.flow, ip);
    if (!bumped || bumped.attempts >= MAX_OTP_VERIFY_ATTEMPTS) {
      return { ok: false, message: OTP_TOO_MANY, statusCode: 429, retryAfter: RESEND_COOLDOWN_SEC };
    }
    return { ok: false, message: "Invalid verification code.", statusCode: 400 };
  }

  /** Single-winner consume — prevents duplicate sessions on concurrent verify. */
  const consumed = await AuthOtp.findOneAndUpdate(
    {
      _id: doc._id,
      consumedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
      attempts: { $lt: MAX_OTP_VERIFY_ATTEMPTS },
    },
    { $set: { consumedAt: new Date() } },
    { new: true },
  );

  if (!consumed) {
    return {
      ok: false,
      message: "This code was already used. Request a new one.",
      statusCode: 400,
    };
  }

  await clearOtpVerifyFailures(emailLower, params.flow, ip);

  if (params.flow === "signup") {
    const payload = consumed.signupPayload as SignupOtpPayload | undefined;
    if (!payload?.name || !payload?.password) {
      await AuthOtp.deleteOne({ _id: consumed._id });
      return {
        ok: false,
        message: "Signup session invalid. Please start again.",
        statusCode: 400,
      };
    }
    await AuthOtp.deleteOne({ _id: consumed._id });
    return {
      ok: true,
      flow: "signup",
      email: emailLower,
      signupPayload: payload,
    };
  }

  if (params.flow === "login") {
    const user = await User.findOne({ email: emailLower }).select("+googleId");
    if (!user || user.googleId || !user.isActive || user.emailVerified === false) {
      await AuthOtp.deleteOne({ _id: consumed._id });
      return { ok: false, message: OTP_INVALID, statusCode: 400 };
    }
    await AuthOtp.deleteOne({ _id: consumed._id });
    return { ok: true, flow: "login", user };
  }

  const { raw, hash, expiresAt } = issuePasswordResetToken();
  await AuthOtp.updateOne(
    { _id: consumed._id },
    {
      $set: {
        resetTokenHash: hash,
        resetTokenExpiresAt: expiresAt,
      },
    },
  );

  return { ok: true, flow: "forgot_password", resetToken: raw };
}
