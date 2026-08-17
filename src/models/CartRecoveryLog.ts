import { Schema, model, Document } from 'mongoose';

export interface ICartRecoveryLog extends Document {
  user: string;
  sentAt: Date;
  channel: 'email' | 'push' | 'both';
  cartTotal: number;
  itemCount: number;
  createdAt: Date;
}

const cartRecoveryLogSchema = new Schema<ICartRecoveryLog>(
  {
    user: { type: String, required: true, index: true },
    sentAt: { type: Date, required: true, default: Date.now },
    channel: { type: String, enum: ['email', 'push', 'both'], default: 'email' },
    cartTotal: { type: Number, default: 0 },
    itemCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

cartRecoveryLogSchema.index({ user: 1, sentAt: -1 });
cartRecoveryLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

const CartRecoveryLog = model<ICartRecoveryLog>(
  'CartRecoveryLog',
  cartRecoveryLogSchema,
);
export default CartRecoveryLog;
