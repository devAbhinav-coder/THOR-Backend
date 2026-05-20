import { Schema, model, Document, Types } from 'mongoose';

export interface ICouponRedemption extends Document {
  coupon: Types.ObjectId;
  user: Types.ObjectId;
  sourceType: 'order' | 'checkout_intent';
  sourceId: Types.ObjectId;
  redeemedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const couponRedemptionSchema = new Schema<ICouponRedemption>(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sourceType: { type: String, enum: ['order', 'checkout_intent'], required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    redeemedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

couponRedemptionSchema.index({ sourceType: 1, sourceId: 1, coupon: 1 }, { unique: true });
couponRedemptionSchema.index({ coupon: 1, user: 1 });
couponRedemptionSchema.index({ redeemedAt: 1 });

const CouponRedemption = model<ICouponRedemption>('CouponRedemption', couponRedemptionSchema);
export default CouponRedemption;
