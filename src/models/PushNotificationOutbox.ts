import { Schema, model, Document } from 'mongoose';

export type PushOutboxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';

export interface IPushNotificationOutbox extends Document {
  dedupeKey: string;
  userId: string;
  title: string;
  body: string;
  link?: string;
  notificationId?: string;
  status: PushOutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const pushNotificationOutboxSchema = new Schema<IPushNotificationOutbox>(
  {
    dedupeKey: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: String,
    notificationId: String,
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

pushNotificationOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
pushNotificationOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 45 });

const PushNotificationOutbox = model<IPushNotificationOutbox>(
  'PushNotificationOutbox',
  pushNotificationOutboxSchema
);
export default PushNotificationOutbox;
