import mongoose, { Document, Schema } from 'mongoose';
import slugify from 'slugify';

export interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  subcategories: string[];
  isActive: boolean;
  productCount: number;
  // Gifting
  isGiftCategory: boolean;
  giftType?: 'corporate' | 'wedding' | 'seasonal' | 'festive' | 'personal';
  minOrderQty: number;
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
    subcategories: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: true },
    productCount: { type: Number, default: 0 },
    isGiftCategory: { type: Boolean, default: false },
    giftType: { type: String, enum: ['corporate', 'wedding', 'seasonal', 'festive', 'personal'] },
    minOrderQty: { type: Number, default: 1, min: 1 },
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
