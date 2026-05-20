import { Response } from "express";
import catchAsync from "../utils/catchAsync";
import { AuthRequest } from "../types";
import { sendSuccess } from "../utils/response";
import AppError from "../utils/AppError";
import {
  listActiveSessions,
  revokeSessionById,
  revokeAllSessionsExcept,
} from "../services/authSessionService";
import {
  readRefreshTokenFromRequest,
  hashToken,
  revokeRefreshByRawCookie,
  clearTokenCookies,
} from "../services/authTokenService";

export const getSessions = catchAsync(async (req: AuthRequest, res: Response) => {
  const raw = readRefreshTokenFromRequest(req);
  const sessions = await listActiveSessions(String(req.user!._id), raw);
  sendSuccess(res, {
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt?.toISOString(),
      current: s.current,
    })),
  });
});

export const revokeSession = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const ok = await revokeSessionById(
      String(req.user!._id),
      req.params.sessionId,
      req,
    );
    if (!ok) {
      throw new AppError("Session not found.", 404);
    }
    sendSuccess(res, {}, "Device signed out.");
  },
);

export const logoutAllDevices = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const raw = readRefreshTokenFromRequest(req);
    const exceptHash = raw ? hashToken(raw) : undefined;
    const count = await revokeAllSessionsExcept(
      String(req.user!._id),
      exceptHash,
      req,
    );
    sendSuccess(res, { revoked: count }, 'Signed out of other devices.');
  },
);

export const logoutAllIncludingCurrent = catchAsync(
  async (req: AuthRequest, res: Response) => {
    await revokeRefreshByRawCookie(readRefreshTokenFromRequest(req), true);
    clearTokenCookies(res);
    sendSuccess(res, {}, "Signed out everywhere.");
  },
);
