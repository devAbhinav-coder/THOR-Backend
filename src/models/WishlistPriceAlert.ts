import { Schema, model, Document, Types } from 'mongoose';

export interface IWishlistPriceAlert extends Document {
  user: Types.ObjectId;
  product: Types.ObjectId;
  baselinePrice: number;
  lastNotifiedPrice?: number;
  lastNotifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const wishlistPriceAlertSchema = new Schema<IWishlistPriceAlert>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    baselinePrice: { type: Number, required: true },
    lastNotifiedPrice: Number,
    lastNotifiedAt: Date,
  },
  { timestamps: true },
);

wishlistPriceAlertSchema.index({ user: 1, product: 1 }, { unique: true });

const WishlistPriceAlert = model<IWishlistPriceAlert>(
  'WishlistPriceAlert',
  wishlistPriceAlertSchema,
);
export default WishlistPriceAlert;
