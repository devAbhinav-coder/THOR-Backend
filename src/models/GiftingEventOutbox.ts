import { Schema, model, Document } from 'mongoose';

export type GiftingOutboxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';

export type GiftingOutboxEventType =
  | 'email_admin_new_request'
  | 'email_admin_quote_rejected'
  | 'email_admin_quote_accepted'
  | 'email_user_quote'
  | 'email_user_order_created'
  | 'notify_admins'
  | 'notify_user';

export interface IGiftingEventOutbox extends Document {
  dedupeKey: string;
  eventType: GiftingOutboxEventType;
  payload: Record<string, unknown>;
  status: GiftingOutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const giftingEventOutboxSchema = new Schema<IGiftingEventOutbox>(
  {
    dedupeKey: { type: String, required: true, unique: true },
    eventType: {
      type: String,
      required: true,
      enum: [
        'email_admin_new_request',
        'email_admin_quote_rejected',
        'email_admin_quote_accepted',
        'email_user_quote',
        'email_user_order_created',
        'notify_admins',
        'notify_user',
      ],
    },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'dead_letter'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    lastError: String,
    nextAttemptAt: { type: Date, default: Date.now },
    processedAt: Date,
  },
  { timestamps: true }
);

giftingEventOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
giftingEventOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const GiftingEventOutbox = model<IGiftingEventOutbox>('GiftingEventOutbox', giftingEventOutboxSchema);
export default GiftingEventOutbox;
