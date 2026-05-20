import { FilterQuery, Types } from 'mongoose';
import { enqueueBroadcastByUserFilter } from '../broadcastService';
import { recordCouponOutbox, scheduleCouponBroadcastDispatch } from './couponBroadcastOutboxService';
import { recordCouponMetric } from './couponMetricsService';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';

type Recipient = { _id: Types.ObjectId; email: string; name?: string };

export const couponBroadcastService = {
  /**
   * Transactional outbox: persist broadcast intent, then attempt immediate dispatch.
   */
  async enqueueCouponAnnouncement(
    couponId: string,
    code: string,
    description: string | undefined,
    buildPayload: (recipient: Recipient) => {
      subject: string;
      html: string;
      jobIdPrefix: string;
    }
  ): Promise<number> {
    const dedupeKey = `coupon_broadcast:${couponId}`;
    const ctx = getRequestContext();

    const outboxId = await recordCouponOutbox({
      dedupeKey,
      couponId,
      code,
      description: description ?? '',
    });

    if (!outboxId) {
      recordCouponMetric('coupon.broadcast.outbox_failure', { couponId });
      logger.error({
        msg: 'coupon_broadcast_outbox_failed',
        couponId,
        requestId: ctx?.requestId,
      });
      return 0;
    }

    scheduleCouponBroadcastDispatch(outboxId, async () => {
      const userFilter: FilterQuery<unknown> = { role: 'user', isActive: true };
      return enqueueBroadcastByUserFilter(userFilter, buildPayload, 400);
    });

    recordCouponMetric('coupon.broadcast.enqueued', { couponId });
    return 0;
  },

  /** Direct enqueue (used by outbox worker after claim). */
  async dispatchAnnouncement(
    code: string,
    description: string | undefined,
    couponId: string,
    tpl: { subject: string; html: string }
  ): Promise<number> {
    const userFilter: FilterQuery<unknown> = { role: 'user', isActive: true };
    return enqueueBroadcastByUserFilter(
      userFilter,
      () => ({
        subject: tpl.subject,
        html: tpl.html,
        jobIdPrefix: `coupon:${couponId}`,
      }),
      400
    );
  },
};
