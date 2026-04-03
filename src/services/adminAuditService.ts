import { Request } from 'express';
import AdminAuditLog from '../models/AdminAuditLog';
import logger from '../utils/logger';

export async function writeAdminAudit(
  req: Request,
  action: string,
  meta: Record<string, unknown> = {},
  targetUser?: string,
  actorOverride?: string
) {
  try {
    const actor = actorOverride ?? String((req as Request & { user?: { _id?: unknown } }).user?._id || '');
    await AdminAuditLog.create({
      actor: actor || undefined,
      targetUser,
      action,
      ip: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: req.get('user-agent') || '',
      meta,
    });
  } catch (err) {
    logger.error('Failed to write admin audit log', { err, action });
  }
}
