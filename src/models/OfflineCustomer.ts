import mongoose, { Schema } from "mongoose";

/** Marketing list: one row per email from offline/POS orders until the customer claims the account. */
export interface IOfflineCustomer extends mongoose.Document {
  email: string;
  phone: string;
  name: string;
  lastOfflineOrderAt: Date;
  offlineOrderCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const offlineCustomerSchema = new Schema<IOfflineCustomer>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 120,
      match: [/^\S+@\S+\.\S+$/, "Invalid email"],
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, "Invalid phone"],
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    lastOfflineOrderAt: { type: Date, required: true, default: Date.now },
    offlineOrderCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

offlineCustomerSchema.index({ lastOfflineOrderAt: -1 });

const OfflineCustomer =
  mongoose.models.OfflineCustomer ||
  mongoose.model<IOfflineCustomer>("OfflineCustomer", offlineCustomerSchema);

export default OfflineCustomer;
