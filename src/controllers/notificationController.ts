import { Response, NextFunction } from 'express';
import { Notification } from '../models/Notification';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { AuthRequest } from '../types';

export const getMyNotifications = catchAsync(async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  // Filter by query parameters if needed
  const filter: any = { user: req.user!._id };
  if (req.query.isRead !== undefined) {
    filter.isRead = req.query.isRead === 'true';
  }

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user!._id, isRead: false }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      notifications,
      unreadCount,
    },
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
  });
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

  res.status(200).json({
    status: 'success',
    data: {
      notification,
    },
  });
});

export const markAllAsRead = catchAsync(async (req: AuthRequest, res: Response) => {
  await Notification.updateMany({ user: req.user!._id, isRead: false }, { isRead: true });

  res.status(200).json({
    status: 'success',
    message: 'All notifications marked as read',
  });
});

export const clearAll = catchAsync(async (req: AuthRequest, res: Response) => {
  await Notification.deleteMany({ user: req.user!._id });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
