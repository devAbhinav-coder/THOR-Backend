import mongoose, { Schema } from 'mongoose';
import { IReview } from '../types';
import { PUBLIC_REVIEW_FILTER } from '../services/reviews/reviewConstants';

const reviewSchema = new Schema<IReview>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: false,
    },
    /** purchase = logged-in verified order; share_link = public form; invite = secure order link */
    source: {
      type: String,
      enum: ['purchase', 'share_link', 'invite'],
      default: 'purchase',
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5'],
    },
    title: {
      type: String,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    comment: {
      type: String,
      required: [true, 'Review comment is required'],
      maxlength: [1000, 'Comment cannot exceed 1000 characters'],
    },
    images: [
      {
        url: String,
        publicId: String,
      },
    ],
    isVerifiedPurchase: { type: Boolean, default: true },
    helpfulVotes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    helpfulCount: { type: Number, default: 0, min: 0 },
    userSnapshot: {
      name: String,
      avatar: String,
    },
    status: {
      type: String,
      enum: ['visible', 'hidden', 'flagged', 'pending_moderation'],
      default: 'visible',
    },
    deletedAt: { type: Date, default: null },
    moderationFlags: [String],
    moderationScore: { type: Number, default: 0 },
    reports: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        reason: {
          type: String,
          enum: ['spam', 'abusive', 'misleading', 'other'],
          required: true,
        },
        details: {
          type: String,
          maxlength: [300, 'Report details cannot exceed 300 characters'],
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    reportCount: { type: Number, default: 0 },
    adminReply: {
      text: { type: String, maxlength: [500, 'Reply cannot exceed 500 characters'] },
      createdAt: { type: Date },
    },
  },
  { timestamps: true }
);

reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, rating: -1 });
reviewSchema.index({ product: 1, status: 1, deletedAt: 1, createdAt: -1 });
reviewSchema.index({ product: 1, helpfulCount: -1, createdAt: -1 });
reviewSchema.index({ 'reports.user': 1, _id: 1 });

reviewSchema.statics.calcAverageRatings = async function (productId: mongoose.Types.ObjectId) {
  const Product = mongoose.model('Product');
  const stats = await this.aggregate([
    {
      $match: {
        product: productId,
        ...PUBLIC_REVIEW_FILTER,
      },
    },
    {
      $group: {
        _id: '$product',
        avgRating: { $avg: '$rating' },
        numRatings: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    await Product.findByIdAndUpdate(productId, {
      'ratings.average': Math.round(stats[0].avgRating * 10) / 10,
      'ratings.count': stats[0].numRatings,
    });
  } else {
    await Product.findByIdAndUpdate(productId, {
      'ratings.average': 0,
      'ratings.count': 0,
    });
  }
};

function resolveProductObjectId(
  product: unknown,
): mongoose.Types.ObjectId | null {
  if (!product) return null;
  if (product instanceof mongoose.Types.ObjectId) return product;
  if (typeof product === 'string' && mongoose.Types.ObjectId.isValid(product)) {
    return new mongoose.Types.ObjectId(product);
  }
  if (typeof product === 'object' && product !== null && '_id' in product) {
    const id = (product as { _id: unknown })._id;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
      return new mongoose.Types.ObjectId(id);
    }
  }
  return null;
}

reviewSchema.post('save', async function () {
  const productId = resolveProductObjectId(this.product);
  if (!productId) return;
  await (
    this.constructor as typeof mongoose.Model & {
      calcAverageRatings: (id: mongoose.Types.ObjectId) => Promise<void>;
    }
  ).calcAverageRatings(productId);
});

reviewSchema.post('findOneAndDelete', async function (doc: IReview) {
  if (doc) {
    const productId = resolveProductObjectId(doc.product);
    if (!productId) return;
    await (
      mongoose.model('Review') as typeof mongoose.Model & {
        calcAverageRatings: (id: mongoose.Types.ObjectId) => Promise<void>;
      }
    ).calcAverageRatings(productId);
  }
});

const Review = mongoose.model<IReview>('Review', reviewSchema);
export default Review;
