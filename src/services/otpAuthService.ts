import crypto from "crypto";
import bcrypt from "bcryptjs";
import AuthOtp, { AuthOtpPurpose } from "../models/AuthOtp";
import User from "../models/User";
import { emailTemplates } from "./emailService";
import { deliverOtpEmail } from "./emailDeliveryService";
import { assertOtpSendAllowed, recordOtpSend } from "./otpRateLimitService";
import { enqueueEmail } from "../queues/emailQueue";
import { sendEmailNow } from "./emailService";
import logger from "../utils/logger";

/** Public API / frontend */
export type OtpFlowType = "signup" | "login" | "forgot_password";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_OTP_VERIFY_ATTEMPTS = 5;

function mapFlowToPurpose(flow: OtpFlowType): AuthOtpPurpose {
  if (flow === "forgot_password") return "password_reset";
  return flow;
}

async function issueOtpCode(): Promise<{ plain: string; hash: string }> {
  const plain = String(crypto.randomInt(100000, 1000000));
  const hash = await bcrypt.hash(plain, 10);
  return { plain, hash };
}

function err(message: string, statusCode: number): Error {
  const e = new Error(message);
  (e as Error & { statusCode?: number }).statusCode = statusCode;
  return e;
}

/** Creates the user after signup OTP is verified and sends the welcome email. */
export async function createVerifiedSignupUser(
  emailLower: string,
  signupPayload: SignupOtpPayload,
): Promise<InstanceType<typeof User>> {
  const user = await User.create({
    name: signupPayload.name,
    email: emailLower,
    password: signupPayload.password,
    phone: signupPayload.phone || undefined,
    emailVerified: true,
    addresses: [],
  });

  const welcome = emailTemplates.welcome(signupPayload.name);
  const payload = {
    to: emailLower,
    subject: welcome.subject,
    html: welcome.html,
  };
  try {
    await sendEmailNow(payload);
  } catch (e) {
    logger.warn(
      `Welcome email direct send failed (${emailLower}): ${(e as Error).message}; retry via queue`,
    );
    await enqueueEmail(payload);
  }
  user.set("welcomeEmailAt", new Date());
  await user.save({ validateModifiedOnly: true });
  return user;
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
  | { ok: true; flow: "forgot_password" }
  | { ok: false; message: string; statusCode: number };

/**
 * Sends a 6-digit OTP immediately via Zoho when possible, with Resend fallback.
 * Enforces: 60s resend cooldown, max 3 sends / 10 min per email (Redis or Mongo).
 */
export async function sendOtp(params: {
  flow: OtpFlowType;
  email: string;
  signup?: SignupOtpBody;
}): Promise<void> {
  const emailLower = params.email.toLowerCase().trim();
  const purpose = mapFlowToPurpose(params.flow);

  const existing = await AuthOtp.findOne({ email: emailLower, purpose });
  if (
    existing?.lastSentAt &&
    Date.now() - new Date(existing.lastSentAt).getTime() < RESEND_COOLDOWN_MS
  ) {
    const waitSec = Math.ceil(
      (RESEND_COOLDOWN_MS -
        (Date.now() - new Date(existing.lastSentAt).getTime())) /
        1000,
    );
    throw err(
      `Please wait ${waitSec}s before requesting another code.`,
      429,
    );
  }

  if (params.flow === "signup") {
    const s = params.signup;
    if (!s?.name || !s.password || !s.phone) {
      throw err("Name, password, and phone are required for signup.", 400);
    }
    const taken = await User.findOne({ email: emailLower });
    if (taken) {
      throw err("An account with this email already exists.", 409);
    }
  } else if (params.flow === "login") {
    const user = await User.findOne({ email: emailLower }).select(
      "+googleId emailVerified isActive name",
    );
    if (!user) {
      throw err("No password account found for this email.", 404);
    }
    if (user.googleId) {
      throw err(
        "This account uses Google sign-in. Use Sign in with Google.",
        400,
      );
    }
    if (!user.isActive) {
      throw err(
        "Your account has been deactivated. Please contact support.",
        403,
      );
    }
    if (user.emailVerified === false) {
      throw err("Please verify your email before signing in.", 403);
    }
  } else if (params.flow === "forgot_password") {
    const user = await User.findOne({ email: emailLower }).select("+googleId name");
    if (!user || user.googleId) {
      /* Do not leak account existence */
      logger.info(`Forgot-password OTP skipped (no eligible account): ${emailLower}`);
      return;
    }
  }

  await assertOtpSendAllowed(emailLower);

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
        signupPayload: {
          name: params.signup.name,
          phone: params.signup.phone,
          password: params.signup.password,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    const tpl = emailTemplates.otpSignup(params.signup.name, plain);
    await recordOtpSend(emailLower);
    await deliverOtpEmail({
      to: emailLower,
      subject: tpl.subject,
      html: tpl.html,
    });
    return;
  }

  if (params.flow === "login") {
    const user = await User.findOne({ email: emailLower });
    if (!user) throw err("No password account found for this email.", 404);
    await AuthOtp.findOneAndUpdate(
      { email: emailLower, purpose: "login" },
      {
        email: emailLower,
        purpose: "login",
        codeHash: hash,
        expiresAt,
        attempts: 0,
        lastSentAt: now,
        $unset: { signupPayload: 1 },
      },
      { upsert: true, new: true, runValidators: true },
    );
    const tpl = emailTemplates.otpLogin(user.name, plain);
    await recordOtpSend(emailLower);
    await deliverOtpEmail({
      to: emailLower,
      subject: tpl.subject,
      html: tpl.html,
    });
    return;
  }

  /* forgot_password */
  const user = await User.findOne({ email: emailLower });
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
      $unset: { signupPayload: 1 },
    },
    { upsert: true, new: true, runValidators: true },
  );
  const tpl = emailTemplates.otpPasswordReset(user.name, plain);
  await recordOtpSend(emailLower);
  await deliverOtpEmail({
    to: emailLower,
    subject: tpl.subject,
    html: tpl.html,
  });
}

/**
 * Resend flow: signup refreshes the code while keeping the stored signup payload.
 * Login / forgot behave like a new `sendOtp` (re-validates account rules).
 */
export async function resendOtp(params: {
  flow: OtpFlowType;
  email: string;
}): Promise<void> {
  const emailLower = params.email.toLowerCase().trim();

  if (params.flow === "signup") {
    const doc = await AuthOtp.findOne({ email: emailLower, purpose: "signup" });
    if (!doc?.signupPayload) {
      throw err("No pending signup for this email. Please start again.", 400);
    }
    if (
      doc.lastSentAt &&
      Date.now() - new Date(doc.lastSentAt).getTime() < RESEND_COOLDOWN_MS
    ) {
      const waitSec = Math.ceil(
        (RESEND_COOLDOWN_MS -
          (Date.now() - new Date(doc.lastSentAt).getTime())) /
          1000,
      );
      throw err(
        `Please wait ${waitSec}s before requesting another code.`,
        429,
      );
    }
    await assertOtpSendAllowed(emailLower);
    const { plain, hash } = await issueOtpCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    const now = new Date();
    await AuthOtp.updateOne(
      { _id: doc._id },
      {
        $set: {
          codeHash: hash,
          expiresAt,
          attempts: 0,
          lastSentAt: now,
        },
      },
    );
    const name = (doc.signupPayload as SignupOtpPayload).name;
    const tpl = emailTemplates.otpSignup(name, plain);
    await recordOtpSend(emailLower);
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
 * Verifies OTP: checks hash, expiry, attempts. Deletes the OTP document on success
 * for signup and login. For forgot_password, keeps the document until reset-password consumes it.
 */
export async function verifyOtp(params: {
  flow: OtpFlowType;
  email: string;
  otp: string;
}): Promise<VerifyOtpResult> {
  const emailLower = params.email.toLowerCase().trim();
  const purpose = mapFlowToPurpose(params.flow);

  const doc = await AuthOtp.findOne({ email: emailLower, purpose });
  if (!doc || doc.expiresAt.getTime() < Date.now()) {
    return { ok: false, message: "Invalid or expired verification code.", statusCode: 400 };
  }
  if (doc.attempts >= MAX_OTP_VERIFY_ATTEMPTS) {
    return {
      ok: false,
      message: "Too many attempts. Please request a new code.",
      statusCode: 429,
    };
  }

  const match = await bcrypt.compare(String(params.otp), doc.codeHash);
  if (!match) {
    await AuthOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
    return { ok: false, message: "Invalid verification code.", statusCode: 400 };
  }

  if (params.flow === "signup") {
    const payload = doc.signupPayload as SignupOtpPayload | undefined;
    if (!payload?.name || !payload?.password) {
      return {
        ok: false,
        message: "Signup session invalid. Please start again.",
        statusCode: 400,
      };
    }
    await AuthOtp.deleteOne({ _id: doc._id });
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
      return { ok: false, message: "Invalid or expired verification code.", statusCode: 400 };
    }
    await AuthOtp.deleteOne({ _id: doc._id });
    return { ok: true, flow: "login", user };
  }

  /* forgot_password — only validates code; reset-password still required */
  return { ok: true, flow: "forgot_password" };
}
