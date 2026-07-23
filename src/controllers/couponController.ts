import { Request, Response, NextFunction } from "express";
import catchAsync from "../types/utils/catchAsync";
import { AuthRequest } from "../types";
import { emailTemplates } from "../services/emailService";
import { sendSuccess } from "../types/utils/response";
import { writeAdminAudit } from "../services/adminAuditService";
import { couponValidationService } from "../services/coupon/couponValidationService";
import { couponAdminService } from "../services/coupon/couponAdminService";
import { couponBroadcastService } from "../services/coupon/couponBroadcastService";
import { getRequestContext } from "../types/utils/requestContext";
import logger from "../types/utils/logger";

export const createCoupon = catchAsync(async (_req: Request, res: Response) => {
  const req = _req as AuthRequest & {
    uploadedCouponImage?: { url: string; publicId: string };
  };
  const body = { ...(req.body as Record<string, unknown>) };
  if (req.uploadedCouponImage) {
    body.imageUrl = req.uploadedCouponImage.url;
    body.imagePublicId = req.uploadedCouponImage.publicId;
  }
  if (!body.imageUrl || body.imageUrl === "") {
    delete body.imageUrl;
    delete body.imagePublicId;
  }

  const coupon = await couponAdminService.createCoupon(body);

  if (body.sendAnnouncement === true || body.sendAnnouncement === "true") {
    const tpl = emailTemplates.couponAnnouncement(
      coupon.code,
      coupon.description,
    );
    await couponBroadcastService.enqueueCouponAnnouncement(
      String(coupon._id),
      coupon.code,
      coupon.description,
      () => ({
        subject: tpl.subject,
        html: tpl.html,
        jobIdPrefix: `coupon:${String(coupon._id)}`,
      }),
    );
    await writeAdminAudit(req, "coupon.broadcast", {
      couponId: String(coupon._id),
      code: coupon.code,
    });
  }

  await writeAdminAudit(req, "coupon.create", {
    couponId: String(coupon._id),
    code: coupon.code,
  });
  sendSuccess(res, { coupon }, "Coupon created", 201);
});

export const getAllCoupons = catchAsync(async (req: Request, res: Response) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await couponAdminService.listCoupons({ page, limit });
  sendSuccess(res, result);
});

export const getCoupon = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponAdminService.getCouponById(req.params.id);
  sendSuccess(res, { coupon });
});

export const updateCoupon = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest & {
    uploadedCouponImage?: { url: string; publicId: string };
  };
  const body = { ...(req.body as Record<string, unknown>) };
  if (reqAuth.uploadedCouponImage) {
    body.imageUrl = reqAuth.uploadedCouponImage.url;
    body.imagePublicId = reqAuth.uploadedCouponImage.publicId;
  }
  if (body.clearImage === true || body.clearImage === "true") {
    body.imageUrl = "";
    body.imagePublicId = "";
  }

  const coupon = await couponAdminService.updateCoupon(req.params.id, body);
  await writeAdminAudit(reqAuth, "coupon.update", { couponId: req.params.id });
  sendSuccess(res, { coupon }, "Coupon updated");
});

export const deleteCoupon = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest;
  await couponAdminService.softDeleteCoupon(req.params.id);
  await writeAdminAudit(reqAuth, "coupon.delete", { couponId: req.params.id });
  res.status(204).end();
});

export const archiveCoupon = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest;
  const coupon = await couponAdminService.archiveCoupon(req.params.id);
  await writeAdminAudit(reqAuth, "coupon.archive", {
    couponId: req.params.id,
    code: coupon.code,
  });
  sendSuccess(res, { coupon }, "Coupon archived");
});

export const validateCoupon = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { code, orderAmount, items } = req.body;
    const ctx = getRequestContext();
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    let lines;
    if (Array.isArray(items) && items.length > 0) {
      const { buildCouponLinesFromProductIds } = await import(
        "../services/coupon/couponLineScopeService"
      );
      lines = await buildCouponLinesFromProductIds(items);
    } else {
      try {
        const { cartService } = await import("../services/cartService");
        const { buildCouponLinesFromCartItems } = await import(
          "../services/coupon/couponLineScopeService"
        );
        const cart = await cartService.getCart(String(req.user!._id));
        if (cart.items?.length) {
          lines = await buildCouponLinesFromCartItems(
            cart.items.map((item) => ({
              product: item.product,
              price: item.price,
              quantity: item.quantity,
            })),
          );
        }
      } catch {
        lines = undefined;
      }
    }

    const result = await couponValidationService.validateForCheckout(
      String(req.user!._id),
      code,
      orderAmount,
      ip,
      lines,
    );

    logger.info({
      msg: "coupon_validated",
      userId: String(req.user!._id),
      code: result.coupon.code,
      discount: result.discount,
      requestId: ctx?.requestId,
    });

    sendSuccess(res, result);
  },
);

export const getEligibleCoupons = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const orderAmount = Number(req.query.orderAmount || 0);
    let lines;
    const itemsRaw = typeof req.query.items === "string" ? req.query.items : "";
    if (itemsRaw) {
      try {
        const parsed = JSON.parse(itemsRaw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const { buildCouponLinesFromProductIds } = await import(
            "../services/coupon/couponLineScopeService"
          );
          const entries = parsed
            .map((row) => {
              const r = row as {
                productId?: unknown;
                price?: unknown;
                quantity?: unknown;
              };
              return {
                productId: String(r.productId || ""),
                price: Number(r.price) || 0,
                quantity: Number(r.quantity) || 0,
              };
            })
            .filter(
              (e) =>
                e.productId &&
                e.quantity > 0 &&
                e.price >= 0 &&
                /^[a-fA-F0-9]{24}$/.test(e.productId),
            );
          if (entries.length) {
            lines = await buildCouponLinesFromProductIds(entries);
          }
        }
      } catch {
        lines = undefined;
      }
    }
    if (!lines) {
      try {
        const { cartService } = await import("../services/cartService");
        const { buildCouponLinesFromCartItems } = await import(
          "../services/coupon/couponLineScopeService"
        );
        const cart = await cartService.getCart(String(req.user!._id));
        if (cart.items?.length) {
          lines = await buildCouponLinesFromCartItems(
            cart.items.map((item) => ({
              product: item.product,
              price: item.price,
              quantity: item.quantity,
            })),
          );
        }
      } catch {
        lines = undefined;
      }
    }
    const { coupons, ineligible, completedOrders } =
      await couponValidationService.getEligibleCoupons(
        String(req.user!._id),
        orderAmount,
        lines,
      );
    sendSuccess(res, { coupons, ineligible, completedOrders });
  },
);

export const getPublicCoupons = catchAsync(async (_req: Request, res: Response) => {
  const coupons = await couponValidationService.listPublicCoupons();
  sendSuccess(res, { coupons });
});
