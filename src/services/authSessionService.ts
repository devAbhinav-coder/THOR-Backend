import { Request } from "express";
import RefreshToken from "../models/RefreshToken";
import { hashToken } from "./authTokenService";
import {
  authRequestMeta,
  deviceLabelFromUserAgent,
} from "../auth/authNormalize";
import { emitAuthEvent } from "./authEventService";

export type SessionView = {
  id: string;
  deviceLabel: string;
  ip?: string;
  createdAt: Date;
  lastUsedAt?: Date;
  current: boolean;
};

export async function listActiveSessions(
  userId: string,
  currentRefreshRaw?: string,
): Promise<SessionView[]> {
  const now = new Date();
  const currentHash =
    currentRefreshRaw && currentRefreshRaw !== "loggedout" ?
      hashToken(currentRefreshRaw)
    : undefined;

  const docs = await RefreshToken.find({
    user: userId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: now },
  })
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .limit(50)
    .lean();

  return docs.map((d) => ({
    id: String(d._id),
    deviceLabel: d.deviceLabel || "Web browser",
    ip: d.ip ?? undefined,
    createdAt: d.createdAt as Date,
    lastUsedAt: d.lastUsedAt as Date | undefined,
    current: Boolean(currentHash && d.tokenHash === currentHash),
  }));
}

export async function revokeSessionById(
  userId: string,
  sessionId: string,
  req?: Request,
): Promise<boolean> {
  const doc = await RefreshToken.findOneAndUpdate(
    {
      _id: sessionId,
      user: userId,
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } },
    { new: true },
  );
  if (!doc) return false;
  emitAuthEvent({
    type: "AUTH_SESSION_REVOKED",
    userId,
    meta: { sessionId, scope: "single" },
    req,
  });
  return true;
}

export async function revokeAllSessionsExcept(
  userId: string,
  exceptTokenHash?: string,
  req?: Request,
): Promise<number> {
  const filter: Record<string, unknown> = {
    user: userId,
    revokedAt: { $exists: false },
  };
  if (exceptTokenHash) {
    filter.tokenHash = { $ne: exceptTokenHash };
  }

  const result = await RefreshToken.updateMany(filter, {
    $set: { revokedAt: new Date() },
  });

  emitAuthEvent({
    type: "AUTH_SESSION_REVOKED",
    userId,
    meta: { count: result.modifiedCount, scope: "all_except_current" },
    req,
  });

  return result.modifiedCount ?? 0;
}

export async function revokeEntireRefreshFamily(
  familyId: string,
  userId: string,
  req?: Request,
): Promise<void> {
  await RefreshToken.updateMany(
    { familyId, user: userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  emitAuthEvent({
    type: "AUTH_REFRESH_REUSE_DETECTED",
    userId,
    meta: { familyId },
    req,
  });
}

export function sessionMetaFromRequest(req: Request): {
  ip: string;
  userAgent: string;
  deviceLabel: string;
} {
  const { ip, userAgent } = authRequestMeta(req);
  return { ip, userAgent, deviceLabel: deviceLabelFromUserAgent(userAgent) };
}
