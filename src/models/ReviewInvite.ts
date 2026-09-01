import mongoose, { Schema, Types } from 'mongoose';

export interface IReviewInvite {
  _id: Types.ObjectId;
  /** High-entropy public token (URL segment). */
  token: string;
  order: Types.ObjectId;
  /** Catalog product ids eligible for review (manual offline lines excluded). */
  productIds: Types.ObjectId[];
  /** Products already reviewed via this invite. */
  reviewedProductIds: Types.ObjectId[];
  expiresAt: Date;
  revokedAt?: Date | null;
  createdByAdmin?: Types.ObjectId | null;
  emailSentAt?: Date | null;
  whatsappSentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const reviewInviteSchema = new Schema<IReviewInvite>(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    productIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    reviewedProductIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    createdByAdmin: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    emailSentAt: { type: Date, default: null },
    whatsappSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

reviewInviteSchema.index({ order: 1, revokedAt: 1 });

const ReviewInvite = mongoose.model<IReviewInvite>('ReviewInvite', reviewInviteSchema);
export default ReviewInvite;
