import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Response, Request } from "express";
import RefreshToken from "../models/RefreshToken";
import User from "../models/User";
import AppError from "../types/utils/AppError";
import { SESSION_EXPIRED } from "../auth/authErrors";
import {
  revokeEntireRefreshFamily,
  sessionMetaFromRequest,
} from "./authSessionService";
import { emitAuthEvent } from "./authEventService";
import { securityLog } from "../types/utils/securityLog";

const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_MS =
  parseInt(process.env.REFRESH_TOKEN_DAYS || "30", 10) * 24 * 60 * 60 * 1000;

/**
 * Native apps need Bearer tokens in the JSON body (no cookie jar).
 * Never trust a spoofable `X-Client` from a browser (Origin present) —
 * same-origin XSS could otherwise harvest refresh tokens from JSON.
 */
function clientWantsBearerTokens(req?: Request): boolean {
  if (!req) return false;
  const origin = req.get("Origin");
  // Browser requests always send Origin on cross-site XHR; same-origin
  // navigations may omit it, but fetch/XHR from pages typically include it.
  // If Origin is present (including "null"), never echo bearer tokens.
  if (origin) return false;

  const client = String(
    req.headers["x-client"] || req.headers["x-client-type"] || "",
  )
    .trim()
    .toLowerCase();
  return client === "mobile" || client === "app" || client === "expo";
}

export const signAccessToken = (userId: string): string => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET as string,
    {
      expiresIn: ACCESS_EXPIRES,
      algorithm: "HS256",
    } as jwt.SignOptions,
  );
};

export const hashToken = (raw: string): string => {
  return crypto.createHash("sha256").update(raw).digest("hex");
};

export type RefreshSessionMeta = {
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
  familyId?: string;
};

export const createRefreshTokenForUser = async (
  userId: string,
  meta: RefreshSessionMeta = {},
): Promise<{ raw: string; expiresAt: Date; familyId: string }> => {
  const raw = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_MS);
  const familyId = meta.familyId || crypto.randomUUID();

  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(raw),
    expiresAt,
    familyId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    deviceLabel: meta.deviceLabel,
    lastUsedAt: new Date(),
  });

  return { raw, expiresAt, familyId };
};

const cookieBase = () => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: (isProd ? "none" : "strict") as "strict" | "none" | "lax",
    secure: isProd,
  };
};

export const setTokenCookies = (
  res: Response,
  accessToken: string,
  refreshRaw: string,
  refreshExpires: Date,
): void => {
  const base = cookieBase();
  res.cookie("accessToken", accessToken, {
    ...base,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie("refreshToken", refreshRaw, {
    ...base,
    expires: refreshExpires,
    maxAge: REFRESH_MS,
  });
};

export const clearTokenCookies = (res: Response): void => {
  const base = cookieBase();
  res.cookie("accessToken", "loggedout", {
    ...base,
    maxAge: 10 * 1000,
  });
  res.cookie("refreshToken", "loggedout", {
    ...base,
    maxAge: 10 * 1000,
  });
};

export const sendAuthResponse = async (
  res: Response,
  user: InstanceType<typeof User>,
  statusCode: number,
  req?: Request,
): Promise<void> => {
  const accessToken = signAccessToken(String(user._id));
  const meta = req ? sessionMetaFromRequest(req) : {};
  const { raw, expiresAt } = await createRefreshTokenForUser(
    String(user._id),
    meta,
  );
  setTokenCookies(res, accessToken, raw, expiresAt);

  const userObj = user.toObject() as unknown as Record<string, unknown>;
  delete userObj["password"];

  const payload: Record<string, unknown> = {
    status: "success",
    message: "Authenticated successfully",
    data: { user: userObj },
  };
  if (clientWantsBearerTokens(req)) {
    payload.token = accessToken;
    payload.refreshToken = raw;
  }

  res.status(statusCode).json(payload);
};

export function readRefreshTokenFromRequest(req: Request): string | undefined {
  const fromCookie = req.cookies?.refreshToken as string | undefined;
  if (fromCookie && fromCookie !== "loggedout") return fromCookie;
  const body = req.body as { refreshToken?: string };
  if (
    typeof body?.refreshToken === "string" &&
    body.refreshToken !== "loggedout"
  ) {
    return body.refreshToken;
  }
  return undefined;
}

/**
 * Rotates refresh token with family tracking. Reuse of a revoked token
 * revokes the entire family (stolen refresh detection).
 */
export async function rotateRefreshToken(
  req: Request,
  res: Response,
): Promise<InstanceType<typeof User>> {
  const raw = readRefreshTokenFromRequest(req);
  if (!raw) {
    throw new AppError(SESSION_EXPIRED, 401);
  }

  const tokenHash = hashToken(raw);
  const doc = await RefreshToken.findOne({ tokenHash });

  if (!doc) {
    throw new AppError(SESSION_EXPIRED, 401);
  }

  if (doc.revokedAt) {
    if (doc.familyId) {
      await revokeEntireRefreshFamily(doc.familyId, String(doc.user), req);
      securityLog("auth.failure", {
        reason: "refresh_token_reuse",
        userId: String(doc.user),
        familyId: doc.familyId,
      });
    }
    throw new AppError(SESSION_EXPIRED, 401);
  }

  if (doc.expiresAt.getTime() < Date.now()) {
    throw new AppError(SESSION_EXPIRED, 401);
  }

  const user = await User.findById(doc.user);
  if (!user || !user.isActive) {
    throw new AppError(SESSION_EXPIRED, 401);
  }

  const meta = sessionMetaFromRequest(req);
  const familyId = doc.familyId || crypto.randomUUID();
  const { raw: newRaw, expiresAt } = await createRefreshTokenForUser(
    String(user._id),
    { ...meta, familyId },
  );

  await RefreshToken.updateOne(
    { _id: doc._id },
    {
      $set: {
        revokedAt: new Date(),
        replacedByTokenHash: hashToken(newRaw),
        lastUsedAt: new Date(),
      },
    },
  );

  const accessToken = signAccessToken(String(user._id));
  setTokenCookies(res, accessToken, newRaw, expiresAt);

  const userObj = user.toObject() as unknown as Record<string, unknown>;
  delete userObj["password"];

  const payload: Record<string, unknown> = {
    status: "success",
    message: "Authenticated successfully",
    data: { user: userObj },
  };
  if (clientWantsBearerTokens(req)) {
    payload.token = accessToken;
    payload.refreshToken = newRaw;
  }

  res.status(200).json(payload);

  return user;
}

export const revokeRefreshByRawCookie = async (
  raw: string | undefined,
  revokeAllForUser = true,
): Promise<void> => {
  if (!raw || raw === "loggedout") return;
  const doc = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  if (!doc) return;

  if (revokeAllForUser) {
    await RefreshToken.updateMany(
      { user: doc.user, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
    return;
  }

  await RefreshToken.updateOne(
    { _id: doc._id },
    { $set: { revokedAt: new Date() } },
  );
};
