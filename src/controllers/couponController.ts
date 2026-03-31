import { Request, Response, NextFunction } from 'express';
import Coupon from '../models/Coupon';
import Order from '../models/Order';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';
import { emailTemplates } from '../services/emailService';
import { sendSuccess } from '../utils/response';
import { enqueueBroadcastByUserFilter } from '../services/broadcastService';

export const createCoupon = catchAsync(async (_req: Request, res: Response) => {
  const req = _req as AuthRequest;
  const coupon = await Coupon.create({
    ...req.body,
    code: req.body.code.toUpperCase(),
  });

  const tpl = emailTemplates.couponAnnouncement(coupon.code, coupon.description);
  await enqueueBroadcastByUserFilter(
    { role: 'user', isActive: true },
    () => ({ subject: tpl.subject, html: tpl.html, jobIdPrefix: `coupon:${String(coupon._id)}` }),
    400
  );

  sendSuccess(res, { coupon }, 'Coupon created', 201);
});

export const getAllCoupons = catchAsync(async (_req: Request, res: Response) => {
  const coupons = await Coupon.find().sort('-createdAt');
  sendSuccess(res, { coupons });
});

export const getCoupon = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) return next(new AppError('Coupon not found.', 404));
  sendSuccess(res, { coupon });
});

export const updateCoupon = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!coupon) return next(new AppError('Coupon not found.', 404));
  sendSuccess(res, { coupon }, 'Coupon updated');
});

export const deleteCoupon = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) return next(new AppError('Coupon not found.', 404));
  res.status(204).end();
});

export const validateCoupon = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { code, orderAmount } = req.body;

  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon) return next(new AppError('Invalid coupon code.', 404));

  const completedOrders = await Order.countDocuments({ user: req.user!._id, status: 'delivered' });
  const validity = (
    coupon as typeof coupon & {
      isValid: (
        userId: string,
        amount: number,
        opts?: { completedOrders?: number }
      ) => { valid: boolean; message?: string };
    }
  ).isValid(String(req.user!._id), orderAmount, { completedOrders });
  if (!validity.valid) {
    return next(new AppError(validity.message || 'Coupon is not valid.', 400));
  }

  const discount = (coupon as typeof coupon & { calculateDiscount: (amount: number) => number }).calculateDiscount(orderAmount);

  sendSuccess(res, {
    coupon: {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      description: coupon.description,
    },
    discount,
    finalAmount: orderAmount - discount,
  });
});

export const getEligibleCoupons = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderAmount = Number(req.query.orderAmount || 0);
  const [coupons, completedOrders] = await Promise.all([
    Coupon.find({ isActive: true }).sort('-createdAt'),
    Order.countDocuments({ user: req.user!._id, status: 'delivered' }),
  ]);

  const eligible: typeof coupons = [];
  const ineligible: Array<{ code: string; reason: string }> = [];

  for (const coupon of coupons) {
    const validity = (
      coupon as typeof coupon & {
        isValid: (
          userId: string,
          amount: number,
          opts?: { completedOrders?: number }
        ) => { valid: boolean; message?: string };
      }
    ).isValid(String(req.user!._id), orderAmount, { completedOrders });

    if (validity.valid) eligible.push(coupon);
    else ineligible.push({ code: coupon.code, reason: validity.message || 'Not eligible' });
  }

  sendSuccess(res, { coupons: eligible, ineligible, completedOrders });
});
