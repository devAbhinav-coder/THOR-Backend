import { Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { AuthRequest } from '../types';
import { sendPaginated, sendSuccess } from '../utils/response';
import {
  listUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
} from '../services/notifications/notificationReadService';
import {
  getWebPushPublicKeyResponse,
  saveWebPushSubscription,
  removeWebPushSubscription,
  saveExpoPushToken,
  removeExpoPushToken,
} from '../services/notifications/pushSubscriptionService';
import { queuePushForUser } from '../services/notifications/notificationDeliveryService';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../services/notifications/notificationPreferenceService';
import { assertSubscribeAllowed, assertTestPushAllowed } from '../services/notifications/notificationAbuseService';
import type { NotificationPaginationQuery } from '../validation/notificationSchemas';
import type { ParsedExpoTokenBody, ParsedPushSubscriptionBody } from '../validation/notificationSchemas';

export const getMyNotifications = catchAsync(async (req: AuthRequest, res: Response) => {
  const query = req.query as unknown as NotificationPaginationQuery;
  const { notifications, unreadCount, total } = await listUserNotifications({
    userId: String(req.user!._id),
    page: query.page,
    limit: query.limit,
    isRead: query.isRead,
  });

  sendPaginated(res, { notifications, unreadCount }, { page: query.page, limit: query.limit, total });
});

export const markAsRead = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notification = await markNotificationRead(String(req.user!._id), req.params.id);
    sendSuccess(res, { notification });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    throw err;
  }
});

export const markAllAsRead = catchAsync(async (req: AuthRequest, res: Response) => {
  await markAllNotificationsRead(String(req.user!._id));
  sendSuccess(res, {}, 'All notifications marked as read');
});

export const clearAll = catchAsync(async (req: AuthRequest, res: Response) => {
  await clearAllNotifications(String(req.user!._id));
  sendSuccess(res, {}, 'All notifications cleared');
});

export const getPushPublicKey = catchAsync(async (_req: AuthRequest, res: Response) => {
  sendSuccess(res, getWebPushPublicKeyResponse());
});

export const subscribePush = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await assertSubscribeAllowed(String(req.user!._id));
    await saveWebPushSubscription(String(req.user!._id), req.body as ParsedPushSubscriptionBody);
    sendSuccess(res, {}, 'Push subscription saved.');
  } catch (err) {
    if (err instanceof AppError) return next(err);
    throw err;
  }
});

export const unsubscribePush = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await assertSubscribeAllowed(String(req.user!._id));
    await removeWebPushSubscription(
      String(req.user!._id),
      (req.body as { endpoint: string }).endpoint
    );
    sendSuccess(res, {}, 'Push subscription removed.');
  } catch (err) {
    if (err instanceof AppError) return next(err);
    throw err;
  }
});

export const subscribeExpoPush = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await assertSubscribeAllowed(String(req.user!._id));
    await saveExpoPushToken(String(req.user!._id), req.body as ParsedExpoTokenBody);
    sendSuccess(res, {}, 'Expo push token saved.');
  } catch (err) {
    if (err instanceof AppError) return next(err);
    throw err;
  }
});

export const unsubscribeExpoPush = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await removeExpoPushToken(String(req.user!._id), req.body as ParsedExpoTokenBody);
    sendSuccess(res, {}, 'Expo push token removed.');
  } catch (err) {
    if (err instanceof AppError) return next(err);
    throw err;
  }
});

export const sendTestPushToSelf = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return next(new AppError('Only admins can send test push notifications.', 403));
  }

  await assertTestPushAllowed(String(req.user!._id));

  await queuePushForUser(
    {
      userId: String(req.user!._id),
      title: 'Test Push Notification',
      body: 'If you received this, push delivery is working for your registered devices.',
      link: '/admin',
    },
    { skipPreferenceCheck: true }
  );

  sendSuccess(res, {}, 'Test push queued for your devices.');
});

export const getNotificationPreferencesHandler = catchAsync(async (req: AuthRequest, res: Response) => {
  const preferences = await getNotificationPreferences(String(req.user!._id));
  sendSuccess(res, { preferences });
});

export const updateNotificationPreferencesHandler = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const preferences = await updateNotificationPreferences(String(req.user!._id), req.body);
    sendSuccess(res, { preferences }, 'Notification preferences updated.');
  }
);
