import mongoose, { Document, Schema } from 'mongoose';

export interface IUserNotificationState extends Document {
  user: mongoose.Types.ObjectId;
  unreadCount: number;
  notificationsLastReadAt: Date | null;
  pushOptIn: boolean;
  mutedCategories: string[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const userNotificationStateSchema = new Schema<IUserNotificationState>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    unreadCount: { type: Number, default: 0, min: 0 },
    notificationsLastReadAt: { type: Date, default: null },
    pushOptIn: { type: Boolean, default: true },
    mutedCategories: { type: [String], default: [] },
    quietHoursStart: { type: String, default: null },
    quietHoursEnd: { type: String, default: null },
  },
  { timestamps: true }
);

export const UserNotificationState = mongoose.model<IUserNotificationState>(
  'UserNotificationState',
  userNotificationStateSchema
);
