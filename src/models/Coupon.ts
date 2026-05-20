import mongoose, { Schema } from 'mongoose';
import { ICoupon } from '../types';
import {
  calculateCouponDiscount,
  evaluateCouponValidity,
} from '../services/coupon/couponBusinessRules';

const couponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: [true, 'Coupon code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: [20, 'Coupon code cannot exceed 20 characters'],
    },
    description: String,
    discountType: {
      type: String,
      enum: ['percentage', 'flat'],
      required: [true, 'Discount type is required'],
    },
    discountValue: {
      type: Number,
      required: [true, 'Discount value is required'],
      min: [0, 'Discount value must be positive'],
    },
    minOrderAmount: {
      type: Number,
      default: 0,
    },
    maxDiscountAmount: Number,
    usageLimit: Number,
    usedCount: { type: Number, default: 0 },
    userUsageLimit: { type: Number, default: 1 },
    usedBy: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        usedAt: { type: Date, default: Date.now },
      },
    ],
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    expiryDate: {
      type: Date,
      required: [true, 'Expiry date is required'],
    },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    applicableCategories: [String],
    eligibilityType: {
      type: String,
      enum: ['all', 'first_order', 'returning'],
      default: 'all',
    },
    minCompletedOrders: {
      type: Number,
      default: 0,
      min: [0, 'Minimum completed orders cannot be negative'],
    },
    maxCompletedOrders: {
      type: Number,
      min: [0, 'Maximum completed orders cannot be negative'],
    },
  },
  { timestamps: true }
);

couponSchema.index({ expiryDate: 1, isActive: 1, deletedAt: 1 });
couponSchema.index({ isActive: 1, startDate: 1, expiryDate: 1, deletedAt: 1 });
couponSchema.index({ deletedAt: 1, createdAt: -1 });
// code index is already created by unique:true on the field

couponSchema.methods.isValid = function (
  userId: string,
  orderAmount: number,
  opts?: { completedOrders?: number }
): { valid: boolean; message?: string } {
  return evaluateCouponValidity(this as unknown as import('../services/coupon/couponBusinessRules').CouponLike, userId, orderAmount, opts);
};

couponSchema.methods.calculateDiscount = function (orderAmount: number): number {
  return calculateCouponDiscount(this as unknown as import('../services/coupon/couponBusinessRules').CouponLike, orderAmount);
};

couponSchema.pre('validate', function (next) {
  const c = this as ICoupon;
  if (c.expiryDate && c.startDate && c.expiryDate <= c.startDate) {
    this.invalidate('expiryDate', 'Expiry date must be after start date');
  }
  if (c.discountType === 'percentage' && c.discountValue > 100) {
    this.invalidate('discountValue', 'Percentage discount cannot exceed 100');
  }
  next();
});

const Coupon = mongoose.model<ICoupon>('Coupon', couponSchema);
export default Coupon;
