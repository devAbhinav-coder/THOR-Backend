import mongoose, { Document, Schema, Types } from 'mongoose';
import slugify from 'slugify';

export interface ISubCategory extends Document {
  name: string;
  slug: string;
  /** Reference to parent Category document */
  categoryId: Types.ObjectId;
  /** Denormalized parent slug for query-joins-free lookups */
  categorySlug: string;
  description?: string;
  /** Cloudinary URL for the SubCategory card image */
  image?: string;
  imagePublicId?: string;
  /** Hero banner shown at the top of /shop/collections/:cat/:sub */
  heroBannerImage?: string;
  heroBannerPublicId?: string;
  /** Admin-controlled SEO meta title */
  metaTitle?: string;
  /** Admin-controlled SEO meta description */
  metaDescription?: string;
  isActive: boolean;
  /** Admin-controlled display order within parent category (lower = first) */
  sortOrder: number;
  /** Cached product count — maintained by migration + aggregation; not authoritative */
  productCount: number;
  /** Migration: set to true after old Category doc is soft-deleted */
  _migratedFromCategoryId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const subCategorySchema = new Schema<ISubCategory>(
  {
    name: {
      type: String,
      required: [true, 'SubCategory name is required'],
      trim: true,
      maxlength: [80, 'SubCategory name cannot exceed 80 characters'],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'categoryId is required'],
      index: true,
    },
    categorySlug: {
      type: String,
      required: [true, 'categorySlug is required'],
      lowercase: true,
      trim: true,
    },
    description: { type: String, maxlength: 500 },
    image: { type: String },
    imagePublicId: { type: String },
    heroBannerImage: { type: String },
    heroBannerPublicId: { type: String },
    metaTitle: { type: String, maxlength: 120 },
    metaDescription: { type: String, maxlength: 320 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    productCount: { type: Number, default: 0 },
    _migratedFromCategoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// Primary navigation: subcategories by category, active only
subCategorySchema.index({ categoryId: 1, isActive: 1 });

// Admin-controlled ordering within a category
subCategorySchema.index({ categoryId: 1, sortOrder: 1 });

// Denormalized slug-based lookups (avoids joins to Category)
subCategorySchema.index({ categorySlug: 1, isActive: 1 });

// slug is already unique: true which creates its own index

// ─── Hooks ───────────────────────────────────────────────────────────────────

subCategorySchema.pre('save', async function (next) {
  if (this.isModified('name') || this.isNew) {
    const baseSlug = slugify(this.name, { lower: true, strict: true });

    // Prefer clean slug; append categorySlug prefix only on collision
    const exists = await mongoose
      .model<ISubCategory>('SubCategory')
      .exists({ slug: baseSlug, _id: { $ne: this._id } });

    if (exists) {
      // e.g. "silk" under both Sarees and Salwar Suits → "sarees-silk" / "salwar-suits-silk"
      this.slug = `${this.categorySlug}-${baseSlug}`;
    } else {
      this.slug = baseSlug;
    }
  }
  next();
});

export default mongoose.model<ISubCategory>('SubCategory', subCategorySchema);
