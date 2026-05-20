import { INotification } from '../../models/Notification';
import { IPushSubscription } from '../../models/PushSubscription';
import { IUserNotificationState } from '../../models/UserNotificationState';

export const NOTIFICATION_LIST_PROJECTION =
  '_id user title message type link isRead createdAt updatedAt' as const;

export function effectiveIsRead(
  notification: Pick<INotification, 'isRead' | 'createdAt'>,
  lastReadAt: Date | null | undefined
): boolean {
  if (notification.isRead) return true;
  if (lastReadAt && notification.createdAt <= lastReadAt) return true;
  return false;
}

export function serializeNotification(
  doc: INotification | Record<string, unknown>,
  lastReadAt?: Date | null
): Record<string, unknown> {
  const n = doc as INotification;
  const createdAt = n.createdAt instanceof Date ? n.createdAt : new Date(String(n.createdAt));
  const isRead = effectiveIsRead(
    { isRead: Boolean(n.isRead), createdAt },
    lastReadAt ?? null
  );
  return {
    _id: String(n._id),
    user: n.user ? String(n.user) : undefined,
    title: n.title,
    message: n.message,
    type: n.type,
    link: n.link,
    isRead,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

export function serializePushSubscription(sub: IPushSubscription): Record<string, unknown> {
  return {
    _id: String(sub._id),
    endpoint: sub.endpoint,
    isActive: sub.isActive,
    platform: sub.platform,
    deviceType: sub.deviceType,
    lastUsedAt: sub.lastUsedAt,
    createdAt: sub.createdAt,
  };
}

export function sanitizePushPayload(payload: {
  title: string;
  body: string;
  link?: string;
}): { title: string; body: string; link?: string } {
  const title = payload.title.trim().slice(0, 200);
  const body = payload.body.trim().slice(0, 2000);
  const link = payload.link?.trim().slice(0, 2048);
  return { title, body, link: link || undefined };
}

export function unreadFromState(state: IUserNotificationState | null): number {
  if (!state) return 0;
  return Math.max(0, state.unreadCount ?? 0);
}
