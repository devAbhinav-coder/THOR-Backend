import mongoose, { Schema } from 'mongoose';
import { IReview } from '../types';
import Product from './Product';

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
      required: true,
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

reviewSchema.statics.calcAverageRatings = async function (productId: mongoose.Types.ObjectId) {
  const stats = await this.aggregate([
    { $match: { product: productId } },
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

reviewSchema.post('save', async function () {
  await (this.constructor as typeof mongoose.Model & { calcAverageRatings: (id: mongoose.Types.ObjectId) => Promise<void> }).calcAverageRatings(this.product as mongoose.Types.ObjectId);
});

reviewSchema.post('findOneAndDelete', async function (doc: IReview) {
  if (doc) {
    await (mongoose.model('Review') as typeof mongoose.Model & { calcAverageRatings: (id: mongoose.Types.ObjectId) => Promise<void> }).calcAverageRatings(doc.product as mongoose.Types.ObjectId);
  }
});

const Review = mongoose.model<IReview>('Review', reviewSchema);
export default Review;
