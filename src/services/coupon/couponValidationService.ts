import mongoose from "mongoose";
import Coupon from "../../models/Coupon";
import AppError from "../../types/utils/AppError";
import {
  COUPON_QUERY_MAX_MS,
  CouponLike,
  calculateCouponDiscount,
  evaluateCouponValidity,
  normalizeCouponCode,
} from "./couponBusinessRules";
import {
  getCachedCouponByCode,
  getCachedActiveCoupons,
  getCachedValidationResult,
  setCachedActiveCoupons,
  setCachedCouponByCode,
  setCachedValidationResult,
  validationCacheKey,
} from "./couponCacheService";
import { getUserDeliveredOrderCount } from "./couponUserStatsService";
import { recordCouponMetric } from "./couponMetricsService";
import {
  clearCouponAbuseCounter,
  isCouponValidationThrottled,
  recordFailedCouponAttempt,
} from "./couponAbuseService";
import { toCouponValidatePayload } from "./couponDto";
import { getRequestContext } from "../../types/utils/requestContext";
import logger from "../../types/utils/logger";

const ACTIVE_COUPON_DB_FILTER = {
  isActive: true,
  deletedAt: null,
  archivedAt: null,
};

export const couponValidationService = {
  async findCouponByCode(code: string): Promise<CouponLike | null> {
    const normalized = normalizeCouponCode(code);
    const cached = await getCachedCouponByCode(normalized);
    if (cached) return cached;

    const doc = await Coupon.findOne({ code: normalized, deletedAt: null })
      .select("+usedBy")
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean<CouponLike>();
    if (doc) await setCachedCouponByCode(normalized, doc);
    return doc;
  },

  async validateForCheckout(
    userId: string,
    code: string,
    orderAmount: number,
    ip: string,
  ): Promise<{
    coupon: ReturnType<typeof toCouponValidatePayload>;
    discount: number;
    finalAmount: number;
  }> {
    const normalized = normalizeCouponCode(code);
    const ctx = getRequestContext();

    if (await isCouponValidationThrottled(userId, ip)) {
      throw new AppError(
        "Too many invalid coupon attempts. Please try again later.",
        429,
      );
    }

    const cacheKey = validationCacheKey(userId, normalized, orderAmount);
    const cached = await getCachedValidationResult<{
      coupon: ReturnType<typeof toCouponValidatePayload>;
      discount: number;
      finalAmount: number;
    }>(cacheKey);
    if (cached) {
      recordCouponMetric("coupon.validate.success", { cached: true });
      return cached;
    }

    const coupon = await this.findCouponByCode(normalized);
    if (!coupon) {
      await recordFailedCouponAttempt(userId, ip, normalized);
      recordCouponMetric("coupon.validate.failure", { reason: "not_found" });
      throw new AppError("Invalid coupon code.", 404);
    }

    const completedOrders = await getUserDeliveredOrderCount(userId);
    const validity = evaluateCouponValidity(coupon, userId, orderAmount, {
      completedOrders,
    });
    if (!validity.valid) {
      await recordFailedCouponAttempt(userId, ip, normalized);
      recordCouponMetric("coupon.validate.failure", { reason: "invalid" });
      logger.info({
        msg: "coupon_validate_rejected",
        userId,
        couponId: String(coupon._id),
        code: normalized,
        reason: validity.message,
        requestId: ctx?.requestId,
      });
      throw new AppError(validity.message || "Coupon is not valid.", 400);
    }

    const discount = calculateCouponDiscount(coupon, orderAmount);
    const payload = {
      coupon: toCouponValidatePayload(coupon),
      discount,
      finalAmount: orderAmount - discount,
    };

    await setCachedValidationResult(cacheKey, payload);
    await clearCouponAbuseCounter(userId, ip);
    recordCouponMetric("coupon.validate.success", { cached: false });
    return payload;
  },

  async getEligibleCoupons(
    userId: string,
    orderAmount: number,
  ): Promise<{
    coupons: CouponLike[];
    ineligible: Array<{ code: string; reason: string }>;
    completedOrders: number;
  }> {
    const now = new Date();
    recordCouponMetric("coupon.eligible.fetch");

    let coupons = await getCachedActiveCoupons();
    if (!coupons) {
      coupons = await Coupon.find({
        ...ACTIVE_COUPON_DB_FILTER,
        startDate: { $lte: now },
        expiryDate: { $gt: now },
        $or: [
          { usageLimit: { $exists: false } },
          { usageLimit: null },
          { $expr: { $lt: ["$usedCount", "$usageLimit"] } },
        ],
      })
        .select("-usedBy")
        .sort("-createdAt")
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<CouponLike[]>();
      await setCachedActiveCoupons(coupons);
    }

    const completedOrders = await getUserDeliveredOrderCount(userId);
    const eligible: CouponLike[] = [];
    const ineligible: Array<{ code: string; reason: string }> = [];

    for (const coupon of coupons) {
      const validity = evaluateCouponValidity(coupon, userId, orderAmount, {
        completedOrders,
        now,
      });
      if (validity.valid) eligible.push(coupon);
      else
        ineligible.push({
          code: coupon.code,
          reason: validity.message || "Not eligible",
        });
    }

    return { coupons: eligible, ineligible, completedOrders };
  },

  async evaluateCouponForOrder(
    userId: string,
    checkoutSubtotal: number,
    couponCode?: string,
    cartCouponId?: mongoose.Types.ObjectId,
    cartCouponDiscount?: number,
  ): Promise<{ discount: number; couponId?: mongoose.Types.ObjectId }> {
    if (couponCode) {
      const coupon = await this.findCouponByCode(couponCode);
      if (coupon) {
        const completedOrders = await getUserDeliveredOrderCount(userId);
        const validity = evaluateCouponValidity(
          coupon,
          userId,
          checkoutSubtotal,
          { completedOrders },
        );
        if (validity.valid) {
          return {
            discount: calculateCouponDiscount(coupon, checkoutSubtotal),
            couponId: coupon._id as mongoose.Types.ObjectId,
          };
        }
      }
      return { discount: 0 };
    }
    if (cartCouponId && cartCouponDiscount !== undefined) {
      return { discount: cartCouponDiscount, couponId: cartCouponId };
    }
    return { discount: 0 };
  },
};
