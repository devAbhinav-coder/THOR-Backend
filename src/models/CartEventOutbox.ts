import { Schema, model, Document } from 'mongoose';

export type CartOutboxStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type CartOutboxEventType =
  | 'cart.item.added'
  | 'cart.item.removed'
  | 'cart.item.updated'
  | 'cart.coupon.applied'
  | 'cart.coupon.removed'
  | 'cart.cleared'
  | 'cart.abandoned';

export interface ICartEventOutbox extends Document {
  dedupeKey: string;
  eventType: CartOutboxEventType;
  payload: Record<string, unknown>;
  status: CartOutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const cartEventOutboxSchema = new Schema<ICartEventOutbox>(
  {
    dedupeKey: { type: String, required: true, unique: true },
    eventType: {
      type: String,
      required: true,
      enum: [
        'cart.item.added',
        'cart.item.removed',
        'cart.item.updated',
        'cart.coupon.applied',
        'cart.coupon.removed',
        'cart.cleared',
        'cart.abandoned',
      ],
    },
    payload: { type: Schema.Types.Mixed, required: true },
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

cartEventOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
cartEventOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

const CartEventOutbox = model<ICartEventOutbox>('CartEventOutbox', cartEventOutboxSchema);
export default CartEventOutbox;
