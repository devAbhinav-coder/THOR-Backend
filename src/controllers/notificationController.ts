import { Response, NextFunction } from 'express';
import { Notification } from '../models/Notification';
import { PushSubscriptionModel } from '../models/PushSubscription';
import ExpoPushToken from '../models/ExpoPushToken';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { AuthRequest } from '../types';
import { sendPaginated, sendSuccess } from '../utils/response';
import { getVapidPublicKey, isWebPushConfigured } from '../services/webPushService';
import { enqueuePush } from '../queues/pushQueue';
import { isExpoPushToken } from '../utils/isExpoPushToken';

export const getMyNotifications = catchAsync(async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  // Filter by query parameters if needed
  const filter: Record<string, unknown> = { user: req.user!._id };
  if (req.query.isRead !== undefined) {
    filter.isRead = req.query.isRead === 'true';
  }

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user!._id, isRead: false }),
  ]);

  sendPaginated(res, { notifications, unreadCount }, { page, limit, total });
});

export const markAsRead = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user!._id },
    { isRead: true },
    { new: true, runValidators: true }
  );

  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }

  sendSuccess(res, { notification });
});

export const markAllAsRead = catchAsync(async (req: AuthRequest, res: Response) => {
  await Notification.updateMany({ user: req.user!._id, isRead: false }, { isRead: true });

  sendSuccess(res, {}, 'All notifications marked as read');
});

export const clearAll = catchAsync(async (req: AuthRequest, res: Response) => {
  await Notification.deleteMany({ user: req.user!._id });

  sendSuccess(res, {}, 'All notifications cleared');
});

export const getPushPublicKey = catchAsync(async (_req: AuthRequest, res: Response, next: NextFunction) => {
  if (!isWebPushConfigured()) {
    sendSuccess(res, { enabled: false, publicKey: '' });
    return;
  }
  sendSuccess(res, { enabled: true, publicKey: getVapidPublicKey() });
});

export const subscribePush = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!isWebPushConfigured()) {
    return next(new AppError('Web push is not configured on server.', 503));
  }

  const { subscription } = req.body as {
    subscription?: {
      endpoint?: string;
      expirationTime?: number | null;
      keys?: { p256dh?: string; auth?: string };
    };
  };
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return next(new AppError('Invalid push subscription payload.', 400));
  }

  await PushSubscriptionModel.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      user: req.user!._id,
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      isActive: true,
    },
    { upsert: true, new: true, runValidators: true }
  );

  sendSuccess(res, {}, 'Push subscription saved.');
});

export const unsubscribePush = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  if (!endpoint) {
    return next(new AppError('Endpoint is required.', 400));
  }
  await PushSubscriptionModel.updateOne({ endpoint, user: req.user!._id }, { isActive: false });
  sendSuccess(res, {}, 'Push subscription removed.');
});

/** Native apps (Expo) — store Expo push token for FCM/APNs delivery via Expo. */
export const subscribeExpoPush = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const raw = String(req.body?.expoPushToken ?? req.body?.token ?? '').trim();
  if (!raw || !isExpoPushToken(raw)) {
    return next(new AppError('Invalid Expo push token.', 400));
  }

  await ExpoPushToken.findOneAndUpdate(
    { user: req.user!._id, token: raw },
    { user: req.user!._id, token: raw },
    { upsert: true, new: true, runValidators: true },
  );

  sendSuccess(res, {}, 'Expo push token saved.');
});

export const unsubscribeExpoPush = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const raw = String(req.body?.expoPushToken ?? req.body?.token ?? '').trim();
  if (!raw) {
    return next(new AppError('Expo push token is required.', 400));
  }
  await ExpoPushToken.deleteMany({ user: req.user!._id, token: raw });
  sendSuccess(res, {}, 'Expo push token removed.');
});

export const sendTestPushToSelf = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return next(new AppError('Only admins can send test push notifications.', 403));
  }

  await enqueuePush({
    userId: String(req.user!._id),
    title: 'Test Push Notification',
    body: 'If you received this, push delivery is working for your registered devices.',
    link: '/admin',
  });

  sendSuccess(res, {}, 'Test push queued for your devices.');
});
