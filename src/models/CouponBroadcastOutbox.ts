import { Schema, model, Document } from 'mongoose';

export type CouponOutboxStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ICouponBroadcastOutbox extends Document {
  dedupeKey: string;
  couponId: string;
  code: string;
  description: string;
  status: CouponOutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const couponBroadcastOutboxSchema = new Schema<ICouponBroadcastOutbox>(
  {
    dedupeKey: { type: String, required: true, unique: true },
    couponId: { type: String, required: true },
    code: { type: String, required: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    lastError: String,
    nextAttemptAt: { type: Date, default: Date.now },
    processedAt: Date,
  },
  { timestamps: true }
);

couponBroadcastOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
couponBroadcastOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const CouponBroadcastOutbox = model<ICouponBroadcastOutbox>(
  'CouponBroadcastOutbox',
  couponBroadcastOutboxSchema
);
export default CouponBroadcastOutbox;
