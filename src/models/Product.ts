import mongoose, { Schema, Types } from 'mongoose';
import slugify from 'slugify';
import { IProduct } from '../types';

const customFieldSchema = new Schema({
  label: { type: String, required: true, trim: true }, // e.g. "Recipient Name"
  placeholder: { type: String, trim: true },           // e.g. "Enter name to print on card"
  fieldType: { type: String, enum: ['text', 'textarea', 'select', 'image'], default: 'text' },
  options: [{ type: String, trim: true }],             // for select type
  isRequired: { type: Boolean, default: true },
}, { _id: true });

const premiumEditorialPanelSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 120 },
    fields: [
      {
        label: { type: String, required: true, trim: true, maxlength: 80 },
        value: { type: String, required: true, trim: true, maxlength: 300 },
      },
    ],
    note: { type: String, trim: true, maxlength: 1200 },
  },
  { _id: false },
);

const productDetailSchema = new Schema({
  key: { type: String, required: true, trim: true, maxlength: 120 },
  value: { type: String, required: true, trim: true, maxlength: 500 },
}, { _id: false });

const sizeGuideRowSchema = new Schema({
  size: { type: String, required: true, trim: true, maxlength: 80 },
  detail: { type: String, trim: true, maxlength: 500 },
}, { _id: false });

const productImageSchema = new Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  alt: String,
  /** When set, image shows for this color on PDP (case-insensitive match). */
  color: { type: String, trim: true },
});

const variantSchema = new Schema({
  size: String,
  color: String,
  colorCode: String,
  stock: { type: Number, required: true, min: 0, default: 0 },
  sku: { type: String, required: true },
  price: Number,
  /** Purchase / landed cost per unit — for margin & inventory valuation. */
  costPrice: { type: Number, min: 0 },
  /** Lifetime units sold for this SKU (size/color). */
  soldCount: { type: Number, default: 0, min: 0 },
});

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
    },
    shortDescription: {
      type: String,
      maxlength: [500, 'Short description cannot exceed 500 characters'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    comparePrice: {
      type: Number,
      min: [0, 'Compare price cannot be negative'],
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
    },
    /** FK reference to Category document — populated during Phase 2 migration */
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      index: true,
    },
    subcategory: { type: String, trim: true },
    /** FK reference to SubCategory document — populated during Phase 2 migration */
    subcategoryId: {
      type: Schema.Types.ObjectId,
      ref: 'SubCategory',
      index: true,
    },
    fabric: { type: String, trim: true },
    careInstructions: { type: String, trim: true, maxlength: 1000 },
    motionVideoUrl: { type: String, trim: true },
    motionVideoPublicId: { type: String, trim: true },
    motionReelUrl: { type: String, trim: true, maxlength: 500 },
    images: {
      type: [productImageSchema],
      validate: {
        validator: (v: unknown[]) => Array.isArray(v) && v.length > 0 && v.length <= 20,
        message: 'Product must have between 1 and 20 images',
      },
    },
    variants: [variantSchema],
    totalStock: {
      type: Number,
      default: 0,
    },
    tags: [{ type: String, lowercase: true, trim: true }],
    isFeatured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    // Demographic/Audience mapping
    audience: {
      type: String,
      enum: ['women', 'men', 'kids', 'couple'],
      default: 'women',
      index: true,
    },
    // Gifting
    isPremium: { type: Boolean, default: false },
    premiumSlug: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    premiumSubtitle: { type: String, trim: true, maxlength: 200 },
    craftNote: { type: String, trim: true, maxlength: 2000 },
    weaveHours: { type: Number, min: 0 },
    premiumEditorialOpen: premiumEditorialPanelSchema,
    premiumEditorialClose: premiumEditorialPanelSchema,
    premiumHeroImage: productImageSchema,
    sortOrderPremium: { type: Number, default: 0 },
    productDetails: [productDetailSchema],
    highlights: [{ type: String, trim: true, maxlength: 220 }],
    sizeGuide: {
      enabled: { type: Boolean, default: false },
      title: { type: String, trim: true, maxlength: 120 },
      intro: { type: String, trim: true, maxlength: 500 },
      rows: [sizeGuideRowSchema],
      tips: [{ type: String, trim: true, maxlength: 220 }],
    },
    ratings: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
    viewCount: { type: Number, default: 0, min: 0 },
    soldCount: { type: Number, default: 0, min: 0 },
    contentEmbedding: { type: [Number], default: [], select: false },
    hsnCode: { type: String, trim: true },
    seoTitle: String,
    seoDescription: String,
    /** Admin-controlled sort position within a category/subcategory listing */
    sortOrder: { type: Number, default: 0 },
    /** Stores the old slug before Phase 3 slug regeneration — used for 301 redirects */
    oldSlug: { type: String, lowercase: true, sparse: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

productSchema.virtual('discountPercent').get(function (this: IProduct) {
  if (this.comparePrice && this.comparePrice > this.price) {
    return Math.round(((this.comparePrice - this.price) / this.comparePrice) * 100);
  }
  return 0;
});

productSchema.pre<IProduct>('save', function (next) {
  if (this.isModified('name') || this.isNew) {
    this.slug = slugify(this.name, { lower: true, strict: true }) + '-' + Date.now();
  }
  this.totalStock = this.variants.reduce((acc, v) => acc + v.stock, 0);
  next();
});

productSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as Partial<IProduct>;
  if (update.variants) {
    update.totalStock = (update.variants as IProduct['variants']).reduce((acc, v) => acc + v.stock, 0);
  }
  next();
});

productSchema.index(
  {
    name: 'text',
    category: 'text',
    subcategory: 'text',
    fabric: 'text',
    tags: 'text',
    shortDescription: 'text',
    description: 'text',
  },
  {
    name: 'ProSearchTextIndex',
    weights: {
      name: 10,
      category: 8,
      subcategory: 6,
      fabric: 6,
      tags: 5,
      shortDescription: 3,
      description: 1,
    },
  }
);
productSchema.index({ isActive: 1, category: 1 });
productSchema.index({ category: 1, fabric: 1, price: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
productSchema.index({ 'ratings.average': -1 });
productSchema.index({ viewCount: -1 });
productSchema.index({ soldCount: -1 });
// slug index is already created by unique:true on the field
productSchema.index({ isActive: 1, tags: 1 });           // tag-filtered listings
productSchema.index({ isActive: 1, totalStock: 1 });      // in-stock filtering
// Compound indexes for common query patterns
productSchema.index({ isActive: 1, category: 1, price: 1 }); // category filtering with price sort
productSchema.index({ isActive: 1, isFeatured: 1, createdAt: -1 }); // featured products
productSchema.index({ isActive: 1, 'ratings.average': -1, createdAt: -1 }); // top rated
// NOTE: { isActive:1, slug:1 } removed — slug is already unique-indexed, compound is redundant
productSchema.index({ isActive: 1, createdAt: -1 }); // new arrivals
productSchema.index({ isActive: 1, soldCount: -1 }); // best sellers
productSchema.index({ isGiftable: 1, isActive: 1, category: 1 });
productSchema.index({ isGiftable: 1, isActive: 1, occasions: 1 });
productSchema.index({ isPremium: 1, isActive: 1, sortOrderPremium: 1 });
productSchema.index({ isPremium: 1, isActive: 1, premiumSlug: 1 });
productSchema.index({ isPremium: 1, isActive: 1, audience: 1 });
// New FK-based indexes (populated after Phase 2 migration)
productSchema.index({ categoryId: 1, isActive: 1, price: 1 });     // FK category page
productSchema.index({ subcategoryId: 1, isActive: 1, price: 1 });  // FK subcategory page
productSchema.index({ categoryId: 1, subcategoryId: 1, isActive: 1 }); // combined navigation

const Product = mongoose.model<IProduct>('Product', productSchema);
export default Product;
