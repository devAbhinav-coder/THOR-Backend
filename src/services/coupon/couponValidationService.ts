import mongoose from "mongoose";
import Coupon from "../../models/Coupon";
import AppError from "../../types/utils/AppError";
import {
  COUPON_QUERY_MAX_MS,
  CouponLike,
  CouponLineScope,
  calculateCouponDiscount,
  evaluateCouponValidity,
  linesScopeFingerprint,
  normalizeCouponCode,
} from "./couponBusinessRules";
import {
  getCachedCouponByCode,
  getCachedValidationResult,
  setCachedCouponByCode,
  setCachedValidationResult,
  validationCacheKey,
  eligibleCouponsCacheKey,
  getCachedEligibleCoupons,
  setCachedEligibleCoupons,
} from "./couponCacheService";
import { getUserDeliveredOrderCount } from "./couponUserStatsService";
import { recordCouponMetric } from "./couponMetricsService";
import {
  clearCouponAbuseCounter,
  isCouponValidationThrottled,
  recordFailedCouponAttempt,
} from "./couponAbuseService";
import {
  COUPON_STOREFRONT_PROJECTION,
  toCouponStorefrontDto,
  toCouponValidatePayload,
} from "./couponDto";
import { getRequestContext } from "../../types/utils/requestContext";
import logger from "../../types/utils/logger";
import { isWithinValidityWindow } from "./couponBusinessRules";

const ACTIVE_COUPON_DB_FILTER = {
  isActive: true,
  deletedAt: null,
  archivedAt: null,
};

function discountFromValidity(
  coupon: CouponLike,
  orderAmount: number,
  validity: { valid: boolean; eligibleAmount?: number },
  lines?: CouponLineScope[],
): number {
  const base =
    validity.eligibleAmount !== undefined ? validity.eligibleAmount : orderAmount;
  return calculateCouponDiscount(coupon, base, lines);
}

async function enrichCouponScopeNames(coupon: CouponLike): Promise<CouponLike> {
  const scope = coupon.scopeType || "all";

  if (scope === "categories") {
    if (coupon.applicableCategories?.length) return coupon;
    if (!coupon.applicableCategoryIds?.length) return coupon;
    const Category = (await import("../../models/Category")).default;
    const cats = await Category.find({
      _id: { $in: coupon.applicableCategoryIds },
    })
      .select("name")
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean<{ name: string }[]>();
    return {
      ...coupon,
      applicableCategories: cats.map((c) => c.name).filter(Boolean),
    };
  }

  if (scope === "subcategories") {
    if (coupon.applicableSubcategoryNames?.length) return coupon;
    if (!coupon.applicableSubcategoryIds?.length) return coupon;
    const SubCategory = (await import("../../models/SubCategory")).default;
    const subs = await SubCategory.find({
      _id: { $in: coupon.applicableSubcategoryIds },
    })
      .select("name")
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean<{ name: string }[]>();
    return {
      ...coupon,
      applicableSubcategoryNames: subs.map((s) => s.name).filter(Boolean),
    };
  }

  return coupon;
}

export const couponValidationService = {
  async findCouponByCode(code: string): Promise<CouponLike | null> {
    const normalized = normalizeCouponCode(code);
    const cached = await getCachedCouponByCode(normalized);
    if (cached) return enrichCouponScopeNames(cached);

    const doc = await Coupon.findOne({ code: normalized, deletedAt: null })
      .select("+usedBy")
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean<CouponLike>();
    if (doc) {
      const enriched = await enrichCouponScopeNames(doc);
      await setCachedCouponByCode(normalized, enriched);
      return enriched;
    }
    return doc;
  },

  async listPublicCoupons(): Promise<ReturnType<typeof toCouponStorefrontDto>[]> {
    const now = new Date();
    const coupons = await Coupon.find({
      ...ACTIVE_COUPON_DB_FILTER,
      showOnStorefront: true,
      startDate: { $lte: now },
      expiryDate: { $gte: now },
    })
      .select(COUPON_STOREFRONT_PROJECTION)
      .sort("-createdAt")
      .limit(24)
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean<CouponLike[]>();

    return coupons
      .filter((c) => isWithinValidityWindow(c.startDate, c.expiryDate, now))
      .map(toCouponStorefrontDto);
  },

  /** Active targeted (non-all) storefront coupons for shop hasOffer filter. */
  async getActiveTargetedOfferScopes(now = new Date()): Promise<{
    categoryIds: string[];
    subcategoryIds: string[];
    productIds: string[];
  }> {
    const coupons = await Coupon.find({
      ...ACTIVE_COUPON_DB_FILTER,
      showOnStorefront: true,
      scopeType: { $in: ["categories", "subcategories", "products"] },
      startDate: { $lte: now },
      expiryDate: { $gte: now },
    })
      .select(
        "scopeType applicableCategoryIds applicableSubcategoryIds applicableProductIds startDate expiryDate",
      )
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean<CouponLike[]>();

    const categoryIds = new Set<string>();
    const subcategoryIds = new Set<string>();
    const productIds = new Set<string>();

    for (const c of coupons) {
      if (!isWithinValidityWindow(c.startDate, c.expiryDate, now)) continue;
      for (const id of c.applicableCategoryIds || []) categoryIds.add(String(id));
      for (const id of c.applicableSubcategoryIds || []) subcategoryIds.add(String(id));
      for (const id of c.applicableProductIds || []) productIds.add(String(id));
    }

    return {
      categoryIds: [...categoryIds],
      subcategoryIds: [...subcategoryIds],
      productIds: [...productIds],
    };
  },

  async validateForCheckout(
    userId: string,
    code: string,
    orderAmount: number,
    ip: string,
    lines?: CouponLineScope[],
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

    const cacheKey = validationCacheKey(
      userId,
      normalized,
      orderAmount,
      linesScopeFingerprint(lines),
    );
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
      lines,
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

    const discount = discountFromValidity(coupon, orderAmount, validity, lines);
    if (discount <= 0) {
      await recordFailedCouponAttempt(userId, ip, normalized);
      recordCouponMetric("coupon.validate.failure", { reason: "zero_discount" });
      throw new AppError(
        coupon.discountType === "fixed"
          ? (coupon.scopeType || "all") !== "all"
            ? `Eligible items must be priced above ₹${coupon.discountValue} for this offer`
            : `Eligible items must total more than ₹${coupon.discountValue} for this offer`
          : "This coupon does not reduce the price of items in your cart",
        400,
      );
    }
    const payload = {
      coupon: toCouponValidatePayload(coupon),
      discount,
      finalAmount: Math.max(0, orderAmount - discount),
    };

    await setCachedValidationResult(cacheKey, payload);
    await clearCouponAbuseCounter(userId, ip);
    recordCouponMetric("coupon.validate.success", { cached: false });
    return payload;
  },

  async getEligibleCoupons(
    userId: string,
    orderAmount: number,
    lines?: CouponLineScope[],
  ): Promise<{
    coupons: CouponLike[];
    ineligible: Array<{ code: string; reason: string }>;
    completedOrders: number;
  }> {
    const now = new Date();
    recordCouponMetric("coupon.eligible.fetch");

    const userCacheKey = eligibleCouponsCacheKey(
      userId,
      orderAmount,
      linesScopeFingerprint(lines),
    );
    const cached = await getCachedEligibleCoupons(userCacheKey);
    if (cached) {
      recordCouponMetric("coupon.eligible.fetch", { cached: true });
      return cached;
    }

    // Code-only / influencer coupons (showOnStorefront: false) stay off this
    // list — users must type the code. Apply + validate still accept them.
    // $ne:false keeps legacy docs (missing field) treated as public.
    const coupons = await Coupon.find({
      ...ACTIVE_COUPON_DB_FILTER,
      showOnStorefront: { $ne: false },
      startDate: { $lte: now },
      expiryDate: { $gte: now },
      $or: [
        { usageLimit: { $exists: false } },
        { usageLimit: null },
        { $expr: { $lt: ["$usedCount", "$usageLimit"] } },
      ],
    })
      .select("+usedBy")
      .sort("-createdAt")
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean<CouponLike[]>();

    const completedOrders = await getUserDeliveredOrderCount(userId);
    const eligible: CouponLike[] = [];
    const ineligible: Array<{ code: string; reason: string }> = [];

    for (const coupon of coupons) {
      const enriched = await enrichCouponScopeNames(coupon);
      const validity = evaluateCouponValidity(enriched, userId, orderAmount, {
        completedOrders,
        now,
        lines,
      });
      if (validity.valid) eligible.push(enriched);
      else
        ineligible.push({
          code: coupon.code,
          reason: validity.message || "Not eligible",
        });
    }

    const payload = { coupons: eligible, ineligible, completedOrders };
    await setCachedEligibleCoupons(userCacheKey, payload);
    return payload;
  },

  async evaluateCouponForOrder(
    userId: string,
    checkoutSubtotal: number,
    couponCode?: string,
    cartCouponId?: mongoose.Types.ObjectId,
    cartCouponDiscount?: number,
    lines?: CouponLineScope[],
  ): Promise<{ discount: number; couponId?: mongoose.Types.ObjectId }> {
    if (couponCode) {
      const coupon = await this.findCouponByCode(couponCode);
      if (!coupon) {
        throw new AppError("Invalid coupon code.", 404);
      }
      const completedOrders = await getUserDeliveredOrderCount(userId);
      const validity = evaluateCouponValidity(
        coupon,
        userId,
        checkoutSubtotal,
        { completedOrders, lines },
      );
      if (!validity.valid) {
        throw new AppError(validity.message || "Coupon is not valid.", 400);
      }
      return {
        discount: discountFromValidity(coupon, checkoutSubtotal, validity, lines),
        couponId: coupon._id as mongoose.Types.ObjectId,
      };
    }
    if (cartCouponId && cartCouponDiscount !== undefined && cartCouponDiscount > 0) {
      const coupon = await Coupon.findById(cartCouponId)
        .select("+usedBy")
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<CouponLike>();
      if (coupon) {
        const completedOrders = await getUserDeliveredOrderCount(userId);
        const enriched = await enrichCouponScopeNames(coupon);
        const validity = evaluateCouponValidity(
          enriched,
          userId,
          checkoutSubtotal,
          { completedOrders, lines },
        );
        if (validity.valid) {
          return {
            discount: discountFromValidity(enriched, checkoutSubtotal, validity, lines),
            couponId: cartCouponId,
          };
        }
      }
      return { discount: 0 };
    }
    return { discount: 0 };
  },
};
