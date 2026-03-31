import User from '../models/User';
import { Notification } from '../models/Notification';
import logger from '../utils/logger';
import { Types } from 'mongoose';

export async function notifyAdmins(title: string, message: string, link?: string, type: 'order' | 'system' | 'alert' = 'system') {
  try {
    const admins = await User.find({ role: 'admin', isActive: true }, '_id');
    if (admins.length === 0) return;

    const notifications = admins.map(admin => ({
      user: admin._id,
      title,
      message,
      link,
      type,
    }));

    await Notification.insertMany(notifications);
  } catch (err) {
    logger.error('Failed to notify admins', { err });
  }
}

export async function notifyUser(
  userId: string | Types.ObjectId,
  title: string,
  message: string,
  link?: string,
  type: 'order' | 'promotion' | 'alert' = 'order'
) {
  try {
    await Notification.create({
      user: userId,
      title,
      message,
      link,
      type,
    });
  } catch (err) {
    logger.error('Failed to notify user', { userId: String(userId), err });
  }
}
