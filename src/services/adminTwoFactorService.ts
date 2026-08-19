import crypto from "crypto";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import User from "../models/User";
import AppError from "../types/utils/AppError";
import { JwtPayload } from "../types";

const ISSUER = "House of Rani Admin";
const BACKUP_CODE_COUNT = 8;

export function generateTotpSetup(email: string): {
  secret: string;
  otpauthUrl: string;
} {
  const secret = speakeasy.generateSecret({
    name: email,
    issuer: ISSUER,
    length: 20,
  });
  if (!secret.base32 || !secret.otpauth_url) {
    throw new AppError("Could not generate authenticator secret.", 500);
  }
  return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
}

export async function totpQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const token = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });
}

export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}

async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(
    codes.map((code) =>
      bcrypt.hash(code.replace(/-/g, "").toLowerCase(), 10),
    ),
  );
}

export async function verifyBackupCode(
  hashedCodes: string[],
  code: string,
): Promise<number> {
  const normalized = code.replace(/-/g, "").toLowerCase();
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(normalized, hashedCodes[i]!)) return i;
  }
  return -1;
}

export function signAdmin2FAPendingToken(userId: string): string {
  return jwt.sign(
    { id: userId, purpose: "admin_2fa_pending" },
    process.env.JWT_SECRET as string,
    { expiresIn: "5m", algorithm: "HS256" },
  );
}

export function verifyAdmin2FAPendingToken(token: string): string {
  const decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
    algorithms: ["HS256"],
  }) as JwtPayload & { purpose?: string };
  if (decoded.purpose !== "admin_2fa_pending" || !decoded.id) {
    throw new AppError("Two-factor session expired. Please sign in again.", 401);
  }
  return decoded.id;
}

export async function getAdminTwoFactorUser(userId: string) {
  return User.findById(userId).select(
    "+adminTwoFactorSecret +adminTwoFactorBackupCodes +password",
  );
}

export async function verifyAdminSecondFactor(
  userId: string,
  code: string,
): Promise<"totp" | "backup"> {
  const user = await getAdminTwoFactorUser(userId);
  if (!user?.adminTwoFactorEnabled || !user.adminTwoFactorSecret) {
    throw new AppError("Two-factor authentication is not enabled.", 400);
  }

  const normalized = code.replace(/\s/g, "");
  if (/^\d{6}$/.test(normalized)) {
    if (verifyTotpCode(user.adminTwoFactorSecret, normalized)) {
      return "totp";
    }
  }

  const backupIdx = await verifyBackupCode(
    user.adminTwoFactorBackupCodes ?? [],
    normalized,
  );
  if (backupIdx >= 0) {
    const nextCodes = [...(user.adminTwoFactorBackupCodes ?? [])];
    nextCodes.splice(backupIdx, 1);
    user.adminTwoFactorBackupCodes = nextCodes;
    await user.save({ validateBeforeSave: false });
    return "backup";
  }

  throw new AppError("Invalid authenticator or backup code.", 401);
}

export async function enableAdminTwoFactor(
  userId: string,
  secret: string,
  code: string,
): Promise<{ backupCodes: string[] }> {
  if (!verifyTotpCode(secret, code)) {
    throw new AppError("Invalid authenticator code. Try again.", 400);
  }

  const plainBackupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(plainBackupCodes);

  await User.findByIdAndUpdate(userId, {
    adminTwoFactorEnabled: true,
    adminTwoFactorSecret: secret,
    adminTwoFactorBackupCodes: hashed,
  });

  return { backupCodes: plainBackupCodes };
}

export async function disableAdminTwoFactor(
  userId: string,
  password: string,
  code: string,
): Promise<void> {
  const user = await getAdminTwoFactorUser(userId);
  if (!user) throw new AppError("User not found.", 404);
  if (!(await user.comparePassword(password))) {
    throw new AppError("Incorrect password.", 401);
  }
  await verifyAdminSecondFactor(userId, code);

  user.adminTwoFactorEnabled = false;
  user.adminTwoFactorSecret = undefined;
  user.adminTwoFactorBackupCodes = [];
  await user.save({ validateBeforeSave: false });
}
