import mongoose, { Schema } from 'mongoose';
import { IPromotion } from '../types';

const promotionSchema = new Schema<IPromotion>(
  {
    name: {
      type: String,
      required: [true, 'Promotion name is required'],
      trim: true,
      maxlength: [120, 'Name cannot exceed 120 characters'],
    },
    description: { type: String, trim: true, maxlength: 500 },
    termsAndConditions: { type: String, trim: true, maxlength: 2000 },
    displayTitle: { type: String, trim: true, maxlength: 120 },
    badgeText: { type: String, trim: true, maxlength: 40 },
    imageUrl: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    promotionType: {
      type: String,
      enum: ['bogo', 'flat', 'percentage'],
      required: [true, 'Promotion type is required'],
    },
    buyQuantity: {
      type: Number,
      default: 1,
      min: [1, 'Buy quantity must be at least 1'],
    },
    getQuantity: {
      type: Number,
      default: 1,
      min: [1, 'Get quantity must be at least 1'],
    },
    getDiscountPercent: {
      type: Number,
      default: 100,
      min: [0, 'Get discount percent cannot be negative'],
      max: [100, 'Get discount percent cannot exceed 100'],
    },
    discountValue: {
      type: Number,
      min: [0, 'Discount value must be positive'],
    },
    maxDiscountAmount: { type: Number, min: 0 },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    scopeType: {
      type: String,
      enum: ['all', 'categories', 'subcategories', 'products'],
      default: 'all',
    },
    categoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    subcategoryIds: [{ type: Schema.Types.ObjectId, ref: 'SubCategory' }],
    productIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    showOnStorefront: { type: Boolean, default: true },
    priority: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

promotionSchema.index({ isActive: 1, startDate: 1, endDate: 1, deletedAt: 1, archivedAt: 1 });
promotionSchema.index({ deletedAt: 1, createdAt: -1 });
promotionSchema.index({
  showOnStorefront: 1,
  isActive: 1,
  startDate: 1,
  endDate: 1,
  deletedAt: 1,
  archivedAt: 1,
});

promotionSchema.pre('validate', function (next) {
  const p = this as IPromotion;
  if (p.endDate && p.startDate && p.endDate <= p.startDate) {
    this.invalidate('endDate', 'End date must be after start date');
  }
  if (p.promotionType === 'percentage' && p.discountValue != null && p.discountValue > 100) {
    this.invalidate('discountValue', 'Percentage discount cannot exceed 100');
  }
  if (p.promotionType === 'bogo') {
    if (!p.buyQuantity || p.buyQuantity < 1) {
      this.invalidate('buyQuantity', 'Buy quantity is required for BOGO');
    }
    if (!p.getQuantity || p.getQuantity < 1) {
      this.invalidate('getQuantity', 'Get quantity is required for BOGO');
    }
  } else if (p.discountValue == null || p.discountValue <= 0) {
    this.invalidate('discountValue', 'Discount value is required');
  }
  const scope = p.scopeType || 'all';
  if (scope === 'categories' && !(p.categoryIds?.length > 0)) {
    this.invalidate('categoryIds', 'Select at least one category');
  }
  if (scope === 'subcategories' && !(p.subcategoryIds?.length > 0)) {
    this.invalidate('subcategoryIds', 'Select at least one subcategory');
  }
  if (scope === 'products' && !(p.productIds?.length > 0)) {
    this.invalidate('productIds', 'Select at least one product');
  }
  next();
});

const Promotion = mongoose.model<IPromotion>('Promotion', promotionSchema);
export default Promotion;
