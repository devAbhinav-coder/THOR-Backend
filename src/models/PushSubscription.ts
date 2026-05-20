import mongoose, { Document, Schema } from 'mongoose';

export interface IPushSubscription extends Document {
  user: mongoose.Types.ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
  isActive: boolean;
  platform?: 'web' | 'unknown';
  deviceType?: string;
  appVersion?: string;
  lastUsedAt?: Date;
  endpointHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true, index: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    expirationTime: { type: Number, default: null },
    isActive: { type: Boolean, default: true, index: true },
    platform: { type: String, enum: ['web', 'unknown'], default: 'web' },
    deviceType: { type: String, default: 'browser' },
    appVersion: String,
    lastUsedAt: Date,
    endpointHash: { type: String, index: true },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index({ user: 1, isActive: 1 });

export const PushSubscriptionModel = mongoose.model<IPushSubscription>(
  'PushSubscription',
  pushSubscriptionSchema
);

