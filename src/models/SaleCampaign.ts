import mongoose, { Schema } from 'mongoose';
import { ISaleCampaign } from '../types';

const saleCampaignSchema = new Schema<ISaleCampaign>(
  {
    name: {
      type: String,
      required: [true, 'Sale name is required'],
      trim: true,
      maxlength: [120, 'Sale name cannot exceed 120 characters'],
    },
    description: { type: String, trim: true, maxlength: 500 },
    badgeText: { type: String, trim: true, maxlength: 40, default: 'Sale' },
    discountType: {
      type: String,
      enum: ['percentage', 'flat', 'fixed'],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: [0, 'Discount value must be positive'],
    },
    maxDiscountPerItem: { type: Number, min: 0 },
    imageUrl: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    showOnStorefront: { type: Boolean, default: true },
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
    deletedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

saleCampaignSchema.index({
  isActive: 1,
  startDate: 1,
  endDate: 1,
  deletedAt: 1,
  archivedAt: 1,
});
saleCampaignSchema.index({ deletedAt: 1, createdAt: -1 });

saleCampaignSchema.pre('validate', function (next) {
  const c = this as ISaleCampaign;
  if (c.endDate && c.startDate && c.endDate <= c.startDate) {
    this.invalidate('endDate', 'End date must be after start date');
  }
  if (c.discountType === 'percentage' && c.discountValue > 100) {
    this.invalidate('discountValue', 'Percentage discount cannot exceed 100');
  }
  const scope = c.scopeType || 'all';
  if (scope === 'categories' && !(c.categoryIds?.length > 0)) {
    this.invalidate('categoryIds', 'Select at least one category');
  }
  if (scope === 'subcategories' && !(c.subcategoryIds?.length > 0)) {
    this.invalidate('subcategoryIds', 'Select at least one subcategory');
  }
  if (scope === 'products' && !(c.productIds?.length > 0)) {
    this.invalidate('productIds', 'Select at least one product');
  }
  next();
});

const SaleCampaign = mongoose.model<ISaleCampaign>('SaleCampaign', saleCampaignSchema);
export default SaleCampaign;
