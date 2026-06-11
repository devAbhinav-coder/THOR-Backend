import { Types } from "mongoose";
import PushDeliveryRecord from "../../models/PushDeliveryRecord";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import { recordPushOutbox } from "./pushOutboxService";
import { buildPushDedupeKey } from "./pushDedupe";
import { sanitizePushPayload } from "./notificationDto";
import {
  getNotificationPreferences,
  shouldSuppressPush,
} from "./notificationPreferenceService";
import { recordNotificationMetric } from "./notificationMetricsService";
import type { PushJobData } from "../../queues/pushQueue";

export { trackInvalidPushToken } from "./pushDeliveryTrackingService";

export async function queuePushForUser(
  data: PushJobData,
  options?: { category?: string; skipPreferenceCheck?: boolean },
): Promise<void> {
  const safe = sanitizePushPayload(data);
  const payload: PushJobData = { ...data, ...safe };
  const ctx = getRequestContext();
  const dedupeKey = buildPushDedupeKey(payload);

  if (!options?.skipPreferenceCheck) {
    const prefs = await getNotificationPreferences(payload.userId);
    if (shouldSuppressPush(prefs, options?.category)) {
      logger.info({
        msg: "push_suppressed_by_preferences",
        userId: payload.userId,
        requestId: ctx?.requestId,
        notificationId: payload.notificationId,
      });
      return;
    }
  }

  try {
    await PushDeliveryRecord.findOneAndUpdate(
      { dedupeKey },
      {
        $setOnInsert: {
          dedupeKey,
          userId: payload.userId,
          notificationId: payload.notificationId,
          channel: "combined",
          status: "queued",
          queuedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.warn({
      msg: "push_delivery_record_write_failed",
      dedupeKey,
      error: err instanceof Error ? err.message : "unknown",
    });
  }

  const outboxId = await recordPushOutbox(payload);
  if (!outboxId) {
    recordNotificationMetric("push.delivery.failure", {
      userId: payload.userId,
      phase: "outbox",
    });
  }
}
