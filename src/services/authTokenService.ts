import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import RefreshToken from '../models/RefreshToken';
import User from '../models/User';

const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_MS =
  parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10) * 24 * 60 * 60 * 1000;

export const signAccessToken = (userId: string): string => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET as string, {
    expiresIn: ACCESS_EXPIRES,
    algorithm: 'HS256',
  } as jwt.SignOptions);
};

export const hashToken = (raw: string): string => {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

export const createRefreshTokenForUser = async (
  userId: string
): Promise<{ raw: string; expiresAt: Date }> => {
  const raw = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_MS);
  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(raw),
    expiresAt,
  });
  return { raw, expiresAt };
};

const cookieBase = () => {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: (isProd ? 'none' : 'strict') as 'strict' | 'none' | 'lax',
    secure: isProd,
  };
};

export const setTokenCookies = (
  res: Response,
  accessToken: string,
  refreshRaw: string,
  refreshExpires: Date
): void => {
  const base = cookieBase();
  res.cookie('accessToken', accessToken, {
    ...base,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refreshToken', refreshRaw, {
    ...base,
    expires: refreshExpires,
    maxAge: REFRESH_MS,
  });
};

export const clearTokenCookies = (res: Response): void => {
  const base = cookieBase();
  res.cookie('accessToken', 'loggedout', {
    ...base,
    maxAge: 10 * 1000,
  });
  res.cookie('refreshToken', 'loggedout', {
    ...base,
    maxAge: 10 * 1000,
  });
};

export const sendAuthResponse = async (
  res: Response,
  user: InstanceType<typeof User>,
  statusCode: number
): Promise<void> => {
  const accessToken = signAccessToken(String(user._id));
  const { raw, expiresAt } = await createRefreshTokenForUser(String(user._id));
  setTokenCookies(res, accessToken, raw, expiresAt);

  const userObj = user.toObject() as unknown as Record<string, unknown>;
  delete userObj['password'];

  res.status(statusCode).json({
    status: 'success',
    token: accessToken,
    data: { user: userObj },
  });
};

export const revokeRefreshByRawCookie = async (
  raw: string | undefined
): Promise<void> => {
  if (!raw || raw === 'loggedout') return;
  const doc = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  if (!doc) return;
  await RefreshToken.updateMany(
    { user: doc.user },
    { $set: { revokedAt: new Date() } }
  );
};
