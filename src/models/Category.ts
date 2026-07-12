import mongoose, { Document, Schema } from 'mongoose';
import slugify from 'slugify';

export interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  /** Cloudinary publicId for the category card image — enables deletion */
  imagePublicId?: string;
  /** Hero banner image URL shown at the top of the category page */
  heroBannerImage?: string;
  heroBannerPublicId?: string;
  /** Admin-controlled SEO meta title for /shop/collections/[slug] */
  metaTitle?: string;
  /** Admin-controlled SEO meta description */
  metaDescription?: string;
  /** Admin-controlled display order (lower = first) */
  sortOrder: number;
  /** Legacy: flat string array of subcategory names — deprecated after migration */
  subcategories: string[];
  isActive: boolean;
  /** Legacy cached count — unreliable, use aggregation instead */
  productCount: number;
  // Gifting
  isGiftCategory: boolean;
  giftType?: 'corporate' | 'wedding' | 'seasonal' | 'festive' | 'personal';
  minOrderQty: number;
  /** Migration: marks this document as migrated to SubCategory collection */
  _deprecated?: boolean;
  /** Migration: the SubCategory._id this was converted into (if applicable) */
  _migratedToSubcategoryId?: import('mongoose').Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true,
      maxlength: [50, 'Category name cannot exceed 50 characters'],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },
    description: { type: String, maxlength: 500 },
    image: { type: String },
    imagePublicId: { type: String },
    heroBannerImage: { type: String },
    heroBannerPublicId: { type: String },
    metaTitle: { type: String, maxlength: 120 },
    metaDescription: { type: String, maxlength: 320 },
    sortOrder: { type: Number, default: 0 },
    // Legacy: flat string array — deprecated post-migration, kept for backward compat
    subcategories: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: true },
    productCount: { type: Number, default: 0 },
    isGiftCategory: { type: Boolean, default: false },
    giftType: { type: String, enum: ['corporate', 'wedding', 'seasonal', 'festive', 'personal'] },
    minOrderQty: { type: Number, default: 1, min: 1 },
    // Migration tracking
    _deprecated: { type: Boolean, default: false },
    _migratedToSubcategoryId: { type: Schema.Types.ObjectId, ref: 'SubCategory' },
  },
  { timestamps: true }
);

categorySchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

export default mongoose.model<ICategory>('Category', categorySchema);
