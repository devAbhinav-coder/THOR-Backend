import { Notification } from "../../models/Notification";
import PushNotificationOutbox from "../../models/PushNotificationOutbox";
import logger from "../../types/utils/logger";

const DEFAULT_RETENTION_DAYS = Number(
  process.env.NOTIFICATION_RETENTION_DAYS || 180,
);
export async function archiveStaleNotifications(): Promise<number> {
  const cutoff = new Date(
    Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const result = await Notification.updateMany(
    {
      archivedAt: null,
      createdAt: { $lt: cutoff },
      isRead: true,
    },
    { $set: { archivedAt: new Date() } },
  ).maxTimeMS(30_000);

  const modified = result.modifiedCount ?? 0;
  if (modified > 0) {
    logger.info({
      msg: "notification_retention_archived",
      count: modified,
      cutoff,
    });
  }
  return modified;
}

export async function purgeCompletedPushOutbox(
  olderThanDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await PushNotificationOutbox.deleteMany({
    status: "completed",
    processedAt: { $lt: cutoff },
  }).maxTimeMS(10_000);
  return result.deletedCount ?? 0;
}

export async function runNotificationRetentionBatch(): Promise<{
  archived: number;
  outboxPurged: number;
}> {
  const archived = await archiveStaleNotifications();
  const outboxPurged = await purgeCompletedPushOutbox();
  return { archived, outboxPurged };
}
