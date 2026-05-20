import { Types } from 'mongoose';
import { UserNotificationState } from '../../models/UserNotificationState';
import { getOrCreateNotificationState } from './notificationStateService';

export type NotificationPreferences = {
  pushOptIn: boolean;
  mutedCategories: string[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

export async function getNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const state = await getOrCreateNotificationState(userId);
  return {
    pushOptIn: state.pushOptIn ?? true,
    mutedCategories: state.mutedCategories ?? [],
    quietHoursStart: state.quietHoursStart ?? null,
    quietHoursEnd: state.quietHoursEnd ?? null,
  };
}

export async function updateNotificationPreferences(
  userId: string,
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const uid = new Types.ObjectId(userId);
  const $set: Record<string, unknown> = {};
  if (patch.pushOptIn !== undefined) $set.pushOptIn = patch.pushOptIn;
  if (patch.mutedCategories !== undefined) $set.mutedCategories = patch.mutedCategories;
  if (patch.quietHoursStart !== undefined) $set.quietHoursStart = patch.quietHoursStart;
  if (patch.quietHoursEnd !== undefined) $set.quietHoursEnd = patch.quietHoursEnd;

  const state = await UserNotificationState.findOneAndUpdate(
    { user: uid },
    { $set, $setOnInsert: { user: uid, unreadCount: 0 } },
    { upsert: true, new: true }
  );

  return {
    pushOptIn: state?.pushOptIn ?? true,
    mutedCategories: state?.mutedCategories ?? [],
    quietHoursStart: state?.quietHoursStart ?? null,
    quietHoursEnd: state?.quietHoursEnd ?? null,
  };
}

/** Returns true when push should be suppressed for category / quiet hours. */
export function shouldSuppressPush(
  prefs: NotificationPreferences,
  category?: string
): boolean {
  if (!prefs.pushOptIn) return true;
  if (category && prefs.mutedCategories.includes(category)) return true;
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;

  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = prefs.quietHoursStart.split(':').map(Number);
  const [eh, em] = prefs.quietHoursEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start <= end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}
