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
  const req = _req as AuthRequest;
  const coupon = await couponAdminService.createCoupon(req.body);

  if (req.body.sendAnnouncement === true) {
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
  const reqAuth = req as AuthRequest;
  const coupon = await couponAdminService.updateCoupon(req.params.id, req.body);
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
    const { code, orderAmount } = req.body;
    const ctx = getRequestContext();
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    const result = await couponValidationService.validateForCheckout(
      String(req.user!._id),
      code,
      orderAmount,
      ip,
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
    const { coupons, ineligible, completedOrders } =
      await couponValidationService.getEligibleCoupons(
        String(req.user!._id),
        orderAmount,
      );
    sendSuccess(res, { coupons, ineligible, completedOrders });
  },
);
