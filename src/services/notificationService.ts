import User from '../models/User';
import { Notification } from '../models/Notification';
import logger from '../utils/logger';
import { Types } from 'mongoose';
import { enqueuePush } from '../queues/pushQueue';
import { enqueueEmail } from '../queues/emailQueue';

export async function notifyAdminsEmail(subject: string, html: string) {
  try {
    const admins = await User.find({ role: 'admin', isActive: true }, 'email');
    if (admins.length === 0) return;

    await Promise.all(
      admins.map((admin) =>
        enqueueEmail({
          to: admin.email,
          subject,
          html,
        }).catch((err) => logger.error(`Failed to send email to admin ${admin.email}`, { err }))
      )
    );
  } catch (err) {
    logger.error('Failed to notify admins by email', { err });
  }
}

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

    const created = await Notification.insertMany(notifications);
    await Promise.all(
      created.map((n) =>
        enqueuePush({
          userId: String(n.user),
          title,
          body: message,
          link,
          notificationId: String(n._id),
        })
      )
    );
  } catch (err) {
    logger.error('Failed to notify admins', { err });
  }
}

export async function notifyUser(
  userId: string | Types.ObjectId,
  title: string,
  message: string,
  link?: string,
  type: 'order' | 'promotion' | 'alert' | 'info' | 'success' | 'error' | 'system' = 'order'
) {
  try {
    const created = await Notification.create({
      user: userId,
      title,
      message,
      link,
      type,
    });
    await enqueuePush({
      userId: String(userId),
      title,
      body: message,
      link,
      notificationId: String(created._id),
    });
  } catch (err) {
    logger.error('Failed to notify user', { userId: String(userId), err });
  }
}
