import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
  user: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: 'order' | 'promotion' | 'system' | 'alert' | 'info' | 'success' | 'error';
  link?: string;
  isRead: boolean;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      // Single-field index on `user` is covered by the compound index below — removed to reduce write overhead
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ['order', 'promotion', 'system', 'alert', 'info', 'success', 'error'],
      default: 'system',
    },
    link: { type: String },
    isRead: {
      type: Boolean,
      default: false,
      // Single-field index on `isRead` is covered by the compound index below — removed to reduce write overhead
    },
    archivedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

// Indexes for faster querying of unread notifications for a user
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, archivedAt: 1, createdAt: -1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
