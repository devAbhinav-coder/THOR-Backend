import mongoose from "mongoose";
import Coupon from "../../models/Coupon";
import AppError from "../../types/utils/AppError";
import {
  assertCouponBusinessRules,
  COUPON_QUERY_MAX_MS,
  normalizeCouponCode,
  normalizeExpiryDate,
} from "./couponBusinessRules";
import { COUPON_ADMIN_PROJECTION, toCouponAdminListDto } from "./couponDto";
import { invalidateCouponCaches } from "./couponCacheService";
import { recordCouponMetric } from "./couponMetricsService";

const ALLOWED_UPDATE_FIELDS = [
  "description",
  "discountType",
  "discountValue",
  "minOrderAmount",
  "maxDiscountAmount",
  "usageLimit",
  "userUsageLimit",
  "startDate",
  "expiryDate",
  "isActive",
  "applicableProducts",
  "applicableCategories",
  "firstOrderOnly",
  "minCompletedOrders",
  "eligibilityType",
  "maxCompletedOrders",
] as const;

export const couponAdminService = {
  buildUpdatePayload(body: Record<string, unknown>): Record<string, unknown> {
    const update: Record<string, unknown> = {};
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        update[field] = body[field];
      }
    }
    if (update.expiryDate) {
      update.expiryDate = normalizeExpiryDate(
        new Date(update.expiryDate as string),
      );
    }
    if (update.startDate) {
      update.startDate = new Date(update.startDate as string);
    }
    return update;
  },

  async createCoupon(data: Record<string, unknown>) {
    const code = normalizeCouponCode(String(data.code));
    const startDate = new Date(data.startDate as string);
    const expiryDate = normalizeExpiryDate(new Date(data.expiryDate as string));

    assertCouponBusinessRules({
      discountType: data.discountType as "percentage" | "flat",
      discountValue: Number(data.discountValue),
      startDate,
      expiryDate,
      usageLimit: data.usageLimit as number | undefined,
      userUsageLimit: data.userUsageLimit as number | undefined,
      minCompletedOrders: data.minCompletedOrders as number | undefined,
      maxCompletedOrders: data.maxCompletedOrders as number | undefined,
    });

    const coupon = await Coupon.create({
      ...data,
      code,
      startDate,
      expiryDate,
    });

    await invalidateCouponCaches(code);
    recordCouponMetric("coupon.admin.create", { couponId: String(coupon._id) });
    return coupon;
  },

  async listCoupons(query: { page?: number; limit?: number }) {
    const filter = { deletedAt: null, archivedAt: null };
    const page = query.page;
    const limit = query.limit;

    if (!page && !limit) {
      const coupons = await Coupon.find(filter)
        .select(COUPON_ADMIN_PROJECTION)
        .sort("-createdAt")
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean();
      return {
        coupons: toCouponAdminListDto(coupons as Record<string, unknown>[]),
      };
    }

    const safeLimit = Math.min(Math.max(limit ?? 20, 1), 100);
    const safePage = Math.max(page ?? 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const [coupons, total] = await Promise.all([
      Coupon.find(filter)
        .select(COUPON_ADMIN_PROJECTION)
        .sort("-createdAt")
        .skip(skip)
        .limit(safeLimit)
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean(),
      Coupon.countDocuments(filter).maxTimeMS(COUPON_QUERY_MAX_MS),
    ]);

    return {
      coupons: toCouponAdminListDto(coupons as Record<string, unknown>[]),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  },

  async getCouponById(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Invalid coupon id.", 400);
    }
    const coupon = await Coupon.findOne({
      _id: id,
      deletedAt: null,
      archivedAt: null,
    })
      .select(COUPON_ADMIN_PROJECTION)
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean();
    if (!coupon) throw new AppError("Coupon not found.", 404);
    return coupon;
  },

  async updateCoupon(id: string, body: Record<string, unknown>) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Invalid coupon id.", 400);
    }
    const update = this.buildUpdatePayload(body);
    if (update.discountType && update.discountValue !== undefined) {
      assertCouponBusinessRules({
        discountType: update.discountType as "percentage" | "flat",
        discountValue: Number(update.discountValue),
        startDate:
          update.startDate ? new Date(update.startDate as string) : new Date(),
        expiryDate:
          update.expiryDate ?
            new Date(update.expiryDate as string)
          : new Date(Date.now() + 86400000),
      });
    }

    const coupon = await Coupon.findOneAndUpdate(
      { _id: id, deletedAt: null, archivedAt: null },
      update,
      {
        new: true,
        runValidators: true,
      },
    )
      .select(COUPON_ADMIN_PROJECTION)
      .maxTimeMS(COUPON_QUERY_MAX_MS);

    if (!coupon) throw new AppError("Coupon not found.", 404);

    if (update.isActive === false) {
      recordCouponMetric("coupon.admin.deactivate", { couponId: id });
    }
    recordCouponMetric("coupon.admin.update", { couponId: id });
    await invalidateCouponCaches(coupon.code);
    return coupon;
  },

  async softDeleteCoupon(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Invalid coupon id.", 400);
    }
    const coupon = await Coupon.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { isActive: false, deletedAt: new Date() } },
      { new: true },
    ).select("code");
    if (!coupon) throw new AppError("Coupon not found.", 404);
    await invalidateCouponCaches(coupon.code);
    recordCouponMetric("coupon.admin.deactivate", {
      couponId: id,
      softDelete: true,
    });
    return coupon;
  },

  async archiveCoupon(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Invalid coupon id.", 400);
    }
    const coupon = await Coupon.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { archivedAt: new Date(), isActive: false } },
      { new: true },
    ).select(COUPON_ADMIN_PROJECTION);
    if (!coupon) throw new AppError("Coupon not found.", 404);
    await invalidateCouponCaches(coupon.code);
    recordCouponMetric("coupon.admin.deactivate", {
      couponId: id,
      archived: true,
    });
    return coupon;
  },
};
