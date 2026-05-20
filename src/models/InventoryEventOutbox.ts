import { Schema, model, Document } from 'mongoose';

export type InventoryOutboxStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type InventoryOutboxEventType = 'invalidate_summary' | 'invalidate_pdp';

export interface IInventoryEventOutbox extends Document {
  dedupeKey: string;
  eventType: InventoryOutboxEventType;
  payload: Record<string, unknown>;
  status: InventoryOutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const inventoryEventOutboxSchema = new Schema<IInventoryEventOutbox>(
  {
    dedupeKey: { type: String, required: true, unique: true },
    eventType: {
      type: String,
      required: true,
      enum: ['invalidate_summary', 'invalidate_pdp'],
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

inventoryEventOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
inventoryEventOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

const InventoryEventOutbox = model<IInventoryEventOutbox>(
  'InventoryEventOutbox',
  inventoryEventOutboxSchema
);
export default InventoryEventOutbox;
