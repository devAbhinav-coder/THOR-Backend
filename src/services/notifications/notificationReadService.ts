import { Types } from 'mongoose';
import { Notification } from '../../models/Notification';
import AppError from '../../utils/AppError';
import {
  NOTIFICATION_LIST_PROJECTION,
  effectiveIsRead,
  serializeNotification,
  unreadFromState,
} from './notificationDto';
import {
  getCachedNotificationPage,
  getCachedUnreadCount,
  scheduleInvalidateNotificationCache,
  setCachedNotificationPage,
  setCachedUnreadCount,
} from './notificationCacheService';
import {
  decrementUnreadIfNeeded,
  getOrCreateNotificationState,
  markAllReadState,
  resetUnreadCount,
} from './notificationStateService';
import { recordNotificationMetric } from './notificationMetricsService';
import { getRequestContext } from '../../utils/requestContext';
import logger from '../../utils/logger';

export const NOTIFICATION_QUERY_MAX_MS = 5000;

type ListParams = {
  userId: string;
  page: number;
  limit: number;
  isRead?: boolean;
};

type ListResult = {
  notifications: Record<string, unknown>[];
  unreadCount: number;
  total: number;
};

export async function listUserNotifications(params: ListParams): Promise<ListResult> {
  const started = Date.now();
  const ctx = getRequestContext();
  const userOid = new Types.ObjectId(params.userId);

  const cached = await getCachedNotificationPage<ListResult>({
    userId: params.userId,
    page: params.page,
    limit: params.limit,
    isRead: params.isRead,
  });
  if (cached) {
    recordNotificationMetric('notification.unread.cache_hit', { userId: params.userId });
    return cached;
  }
  recordNotificationMetric('notification.unread.cache_miss', { userId: params.userId });

  const state = await getOrCreateNotificationState(params.userId);
  const lastReadAt = state.notificationsLastReadAt;

  const filter: Record<string, unknown> = {
    user: userOid,
    archivedAt: null,
  };

  const skip = (params.page - 1) * params.limit;

  const [docs, total] = await Promise.all([
    Notification.find(filter)
      .select(NOTIFICATION_LIST_PROJECTION)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(params.limit)
      .lean()
      .maxTimeMS(NOTIFICATION_QUERY_MAX_MS),
    Notification.countDocuments(filter).maxTimeMS(NOTIFICATION_QUERY_MAX_MS),
  ]);

  let serialized = docs.map((d) =>
    serializeNotification(d as Parameters<typeof serializeNotification>[0], lastReadAt)
  );

  if (params.isRead !== undefined) {
    serialized = serialized.filter((n) => n.isRead === params.isRead);
  }

  let unreadCount = unreadFromState(state);
  const cachedUnread = await getCachedUnreadCount(params.userId);
  if (cachedUnread !== null) {
    unreadCount = cachedUnread;
  } else {
    const reconciled = await reconcileUnreadCount(params.userId, lastReadAt);
    if (reconciled !== unreadCount) {
      const { UserNotificationState } = await import('../../models/UserNotificationState');
      await UserNotificationState.updateOne(
        { user: userOid },
        { $set: { unreadCount: reconciled } }
      );
      unreadCount = reconciled;
    }
    await setCachedUnreadCount(params.userId, unreadCount);
  }

  const result: ListResult = { notifications: serialized, unreadCount, total };
  await setCachedNotificationPage(
    {
      userId: params.userId,
      page: params.page,
      limit: params.limit,
      isRead: params.isRead,
    },
    result
  );

  recordNotificationMetric('notification.fetch.list', {
    userId: params.userId,
    durationMs: Date.now() - started,
  });
  logger.debug({
    msg: 'notification_list_fetched',
    userId: params.userId,
    requestId: ctx?.requestId,
    count: serialized.length,
    unreadCount,
  });

  return result;
}

async function reconcileUnreadCount(
  userId: string,
  lastReadAt: Date | null
): Promise<number> {
  const userOid = new Types.ObjectId(userId);
  const docs = await Notification.find({
    user: userOid,
    archivedAt: null,
    isRead: false,
  })
    .select('createdAt isRead')
    .lean()
    .maxTimeMS(NOTIFICATION_QUERY_MAX_MS);

  return docs.filter((d) => !effectiveIsRead(d, lastReadAt)).length;
}

export async function markNotificationRead(
  userId: string,
  notificationId: string
): Promise<Record<string, unknown>> {
  const state = await getOrCreateNotificationState(userId);
  const existing = await Notification.findOne({
    _id: notificationId,
    user: userId,
    archivedAt: null,
  })
    .select(NOTIFICATION_LIST_PROJECTION)
    .lean()
    .maxTimeMS(NOTIFICATION_QUERY_MAX_MS);

  if (!existing) {
    throw new AppError('Notification not found', 404);
  }

  const wasUnread = !effectiveIsRead(existing, state.notificationsLastReadAt);

  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId, archivedAt: null },
    { isRead: true },
    { new: true, runValidators: true }
  )
    .select(NOTIFICATION_LIST_PROJECTION)
    .maxTimeMS(NOTIFICATION_QUERY_MAX_MS);

  if (!notification) {
    throw new AppError('Notification not found', 404);
  }

  await decrementUnreadIfNeeded(userId, wasUnread);
  scheduleInvalidateNotificationCache(userId);
  recordNotificationMetric('notification.mark_read', { userId, notificationId });

  return serializeNotification(notification, state.notificationsLastReadAt);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await markAllReadState(userId);
  scheduleInvalidateNotificationCache(userId);
  recordNotificationMetric('notification.mark_all_read', { userId });
}

export async function clearAllNotifications(userId: string): Promise<void> {
  const now = new Date();
  await Notification.updateMany(
    { user: userId, archivedAt: null },
    { $set: { archivedAt: now } }
  ).maxTimeMS(NOTIFICATION_QUERY_MAX_MS);
  await resetUnreadCount(userId);
  scheduleInvalidateNotificationCache(userId);
  recordNotificationMetric('notification.clear_all', { userId });
}

export async function onNotificationCreated(userId: string): Promise<void> {
  const { incrementUnreadCount } = await import('./notificationStateService');
  await incrementUnreadCount(userId, 1);
  scheduleInvalidateNotificationCache(userId);
}
