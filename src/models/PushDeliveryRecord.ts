import { Schema, model, Document } from 'mongoose';

export type PushDeliveryStatus =
  | 'queued'
  | 'delivered'
  | 'failed'
  | 'opened'
  | 'clicked';

export type PushChannel = 'web' | 'expo' | 'combined';

export interface IPushDeliveryRecord extends Document {
  dedupeKey: string;
  userId: string;
  notificationId?: string;
  channel: PushChannel;
  status: PushDeliveryStatus;
  endpointOrToken?: string;
  errorMessage?: string;
  queuedAt: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const pushDeliveryRecordSchema = new Schema<IPushDeliveryRecord>(
  {
    dedupeKey: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    notificationId: { type: String, index: true },
    channel: { type: String, enum: ['web', 'expo', 'combined'], default: 'combined' },
    status: {
      type: String,
      enum: ['queued', 'delivered', 'failed', 'opened', 'clicked'],
      default: 'queued',
    },
    endpointOrToken: String,
    errorMessage: String,
    queuedAt: { type: Date, default: Date.now },
    deliveredAt: Date,
  },
  { timestamps: true }
);

pushDeliveryRecordSchema.index({ userId: 1, status: 1, createdAt: -1 });
pushDeliveryRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

const PushDeliveryRecord = model<IPushDeliveryRecord>(
  'PushDeliveryRecord',
  pushDeliveryRecordSchema
);
export default PushDeliveryRecord;
