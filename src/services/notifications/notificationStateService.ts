import { Types } from 'mongoose';
import { UserNotificationState } from '../../models/UserNotificationState';

export async function getOrCreateNotificationState(userId: string | Types.ObjectId) {
  const uid = new Types.ObjectId(String(userId));
  return UserNotificationState.findOneAndUpdate(
    { user: uid },
    { $setOnInsert: { user: uid, unreadCount: 0, notificationsLastReadAt: null } },
    { upsert: true, new: true }
  );
}

export async function incrementUnreadCount(userId: string | Types.ObjectId, delta = 1): Promise<void> {
  const uid = new Types.ObjectId(String(userId));
  await UserNotificationState.findOneAndUpdate(
    { user: uid },
    { $inc: { unreadCount: delta }, $setOnInsert: { user: uid } },
    { upsert: true }
  );
}

export async function resetUnreadCount(userId: string | Types.ObjectId): Promise<void> {
  const uid = new Types.ObjectId(String(userId));
  await UserNotificationState.findOneAndUpdate(
    { user: uid },
    { $set: { unreadCount: 0 }, $setOnInsert: { user: uid } },
    { upsert: true }
  );
}

export async function markAllReadState(userId: string | Types.ObjectId): Promise<Date> {
  const now = new Date();
  const uid = new Types.ObjectId(String(userId));
  await UserNotificationState.findOneAndUpdate(
    { user: uid },
    { $set: { unreadCount: 0, notificationsLastReadAt: now }, $setOnInsert: { user: uid } },
    { upsert: true }
  );
  return now;
}

export async function decrementUnreadIfNeeded(
  userId: string | Types.ObjectId,
  wasUnread: boolean
): Promise<void> {
  if (!wasUnread) return;
  const uid = new Types.ObjectId(String(userId));
  await UserNotificationState.findOneAndUpdate(
    { user: uid, unreadCount: { $gt: 0 } },
    { $inc: { unreadCount: -1 } }
  );
}
