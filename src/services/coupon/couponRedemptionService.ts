import mongoose from 'mongoose';
import Coupon from '../../models/Coupon';
import CouponRedemption from '../../models/CouponRedemption';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';
import {
  COUPON_QUERY_MAX_MS,
  evaluateCouponValidity,
  isWithinValidityWindow,
} from './couponBusinessRules';
import { invalidateCouponCaches } from './couponCacheService';
import { recordCouponMetric } from './couponMetricsService';

export type RedemptionSource = {
  sourceType: 'order' | 'checkout_intent';
  sourceId: mongoose.Types.ObjectId | string;
};

function buildAtomicRedeemFilter(
  couponId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  userUsageLimit: number,
  usageLimit?: number
): Record<string, unknown> {
  const now = new Date();
  const exprParts: Record<string, unknown>[] = [
    {
      $lt: [
        {
          $size: {
            $filter: {
              input: '$usedBy',
              as: 'u',
              cond: { $eq: ['$$u.user', userId] },
            },
          },
        },
        userUsageLimit,
      ],
    },
  ];
  if (usageLimit != null) {
    exprParts.push({ $lt: ['$usedCount', usageLimit] });
  }

  return {
    _id: couponId,
    isActive: true,
    deletedAt: null,
    startDate: { $lte: now },
    expiryDate: { $gt: now },
    $expr: exprParts.length === 1 ? exprParts[0] : { $and: exprParts },
  };
}

export const couponRedemptionService = {
  /**
   * Idempotent, transaction-safe coupon claim tied to order/intent.
   * Returns true when usage was recorded (or already recorded for this source).
   */
  async redeemInTransaction(
    session: mongoose.ClientSession | null,
    userId: mongoose.Types.ObjectId,
    couponId: mongoose.Types.ObjectId,
    subtotal: number,
    source: RedemptionSource,
    logCtx = ''
  ): Promise<boolean> {
    const sourceId = new mongoose.Types.ObjectId(String(source.sourceId));
    const ctx = getRequestContext();

    const existingQuery = CouponRedemption.findOne({
      sourceType: source.sourceType,
      sourceId,
      coupon: couponId,
    });
    const existing = await (session ? existingQuery.session(session) : existingQuery).lean();

    if (existing) {
      recordCouponMetric('coupon.redeem.idempotent', { sourceType: source.sourceType });
      return true;
    }

    const couponQuery = Coupon.findById(couponId).maxTimeMS(COUPON_QUERY_MAX_MS);
    const coupon = await (session ? couponQuery.session(session) : couponQuery);
    if (!coupon) {
      logger.warn({
        msg: 'coupon_redeem_missing',
        couponId: String(couponId),
        logCtx,
        requestId: ctx?.requestId,
      });
      return false;
    }

    const validity = evaluateCouponValidity(coupon, String(userId), subtotal);
    if (!validity.valid) {
      logger.warn({
        msg: 'coupon_redeem_invalid',
        couponId: String(couponId),
        userId: String(userId),
        reason: validity.message,
        logCtx,
        requestId: ctx?.requestId,
      });
      return false;
    }

    if (!isWithinValidityWindow(coupon.startDate, coupon.expiryDate)) {
      return false;
    }

    const filter = buildAtomicRedeemFilter(
      coupon._id as mongoose.Types.ObjectId,
      userId,
      coupon.userUsageLimit,
      coupon.usageLimit
    );

    const applied = await Coupon.updateOne(
      filter,
      {
        $inc: { usedCount: 1 },
        $push: { usedBy: { user: userId, usedAt: new Date() } },
      },
      session ? { session } : {},
    );

    if (applied.modifiedCount !== 1) {
      recordCouponMetric('coupon.redeem.race', { couponId: String(couponId) });
      logger.warn({
        msg: 'coupon_redeem_race',
        couponId: String(couponId),
        userId: String(userId),
        logCtx,
        requestId: ctx?.requestId,
      });
      return false;
    }

    try {
      await CouponRedemption.create(
        [
          {
            coupon: couponId,
            user: userId,
            sourceType: source.sourceType,
            sourceId,
            redeemedAt: new Date(),
          },
        ],
        session ? { session } : {},
      );
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 11000) {
        recordCouponMetric('coupon.redeem.idempotent', { sourceType: source.sourceType });
        return true;
      }
      throw err;
    }

    recordCouponMetric('coupon.redeem.success', { couponId: String(couponId) });
    void invalidateCouponCaches(coupon.code);
    return true;
  },

  /** COD checkout path — throws on race to preserve existing checkout behavior. */
  async redeemOrThrowInTransaction(
    session: mongoose.ClientSession | null,
    userId: mongoose.Types.ObjectId,
    couponId: mongoose.Types.ObjectId,
    subtotal: number,
    source: RedemptionSource
  ): Promise<void> {
    const ok = await this.redeemInTransaction(session, userId, couponId, subtotal, source);
    if (!ok) {
      const { default: AppError } = await import('../../utils/AppError');
      throw new AppError('Coupon could not be applied (please try again).', 409);
    }
  },
};
