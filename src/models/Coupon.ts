import mongoose, { Schema } from 'mongoose';
import { ICoupon } from '../types';

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

couponSchema.index({ expiryDate: 1, isActive: 1 });
// code index is already created by unique:true on the field

couponSchema.methods.isValid = function (
  userId: string,
  orderAmount: number,
  opts?: { completedOrders?: number }
): { valid: boolean; message?: string } {
  const now = new Date();
  const completedOrders = opts?.completedOrders ?? 0;

  if (!this.isActive) return { valid: false, message: 'This coupon is inactive' };
  if (now < this.startDate) return { valid: false, message: 'This coupon is not yet active' };
  if (now > this.expiryDate) return { valid: false, message: 'This coupon has expired' };
  if (this.usageLimit && this.usedCount >= this.usageLimit)
    return { valid: false, message: 'This coupon has reached its usage limit' };
  if (this.minOrderAmount && orderAmount < this.minOrderAmount)
    return { valid: false, message: `Minimum order amount of ₹${this.minOrderAmount} required` };

  const userUsage = this.usedBy.filter((u: { user: mongoose.Types.ObjectId }) => u.user.toString() === userId).length;
  if (userUsage >= this.userUsageLimit)
    return { valid: false, message: 'You have already used this coupon' };

  if (this.eligibilityType === 'first_order' && completedOrders > 0) {
    return { valid: false, message: 'This coupon is valid for first-time customers only' };
  }
  if (this.eligibilityType === 'returning' && completedOrders === 0) {
    return { valid: false, message: 'This coupon is valid for returning customers only' };
  }
  if (this.minCompletedOrders && completedOrders < this.minCompletedOrders) {
    return { valid: false, message: `You need at least ${this.minCompletedOrders} completed orders for this coupon` };
  }
  if (this.maxCompletedOrders !== undefined && completedOrders > this.maxCompletedOrders) {
    return { valid: false, message: 'You are not eligible for this coupon' };
  }

  return { valid: true };
};

couponSchema.methods.calculateDiscount = function (orderAmount: number): number {
  let discount = 0;
  if (this.discountType === 'percentage') {
    discount = (orderAmount * this.discountValue) / 100;
    if (this.maxDiscountAmount) {
      discount = Math.min(discount, this.maxDiscountAmount);
    }
  } else {
    discount = this.discountValue;
  }
  return Math.min(discount, orderAmount);
};

const Coupon = mongoose.model<ICoupon>('Coupon', couponSchema);
export default Coupon;
