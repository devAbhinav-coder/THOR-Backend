import { Schema, model, Document } from 'mongoose';
import { OrderEventType } from '../events/orderEvents';

export type OutboxStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface IOrderEventOutbox extends Document {
  dedupeKey: string;
  eventType: OrderEventType;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const orderEventOutboxSchema = new Schema<IOrderEventOutbox>(
  {
    dedupeKey: { type: String, required: true, unique: true },
    eventType: { type: String, required: true, enum: Object.values(OrderEventType) },
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

orderEventOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
orderEventOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const OrderEventOutbox = model<IOrderEventOutbox>('OrderEventOutbox', orderEventOutboxSchema);
export default OrderEventOutbox;
