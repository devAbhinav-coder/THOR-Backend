import mongoose, { Schema } from 'mongoose';
import slugify from 'slugify';
import { IProduct } from '../types';

const productImageSchema = new Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  alt: String,
});

const variantSchema = new Schema({
  size: String,
  color: String,
  colorCode: String,
  stock: { type: Number, required: true, min: 0, default: 0 },
  sku: { type: String, required: true },
  price: Number,
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
    subcategory: { type: String, trim: true },
    fabric: { type: String, trim: true },
    images: {
      type: [productImageSchema],
      validate: {
        validator: (v: unknown[]) => v.length > 0,
        message: 'At least one image is required',
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
    ratings: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
    viewCount: { type: Number, default: 0, min: 0 },
    seoTitle: String,
    seoDescription: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

productSchema.virtual('discountPercent').get(function () {
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

productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ isActive: 1, category: 1 });
productSchema.index({ category: 1, fabric: 1, price: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
productSchema.index({ 'ratings.average': -1 });
productSchema.index({ viewCount: -1 });
// slug index is already created by unique:true on the field

const Product = mongoose.model<IProduct>('Product', productSchema);
export default Product;
