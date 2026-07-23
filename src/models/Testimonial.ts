import mongoose, { Schema } from 'mongoose';

export interface ITestimonialImage {
  url: string;
  publicId: string;
}

export type TestimonialStatus = 'pending' | 'approved' | 'rejected';
export type TestimonialSource = 'public_link' | 'admin';

export interface ITestimonial {
  _id: mongoose.Types.ObjectId;
  /** Empty / omitted when anonymous */
  displayName?: string;
  isAnonymous: boolean;
  quote: string;
  rating: number;
  images: ITestimonialImage[];
  /** Optional product this story/review is about */
  product?: mongoose.Types.ObjectId;
  /** pending = waiting admin approval (from share link) */
  status: TestimonialStatus;
  source: TestimonialSource;
  isActive: boolean;
  showOnHome: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const testimonialSchema = new Schema<ITestimonial>(
  {
    displayName: { type: String, trim: true, maxlength: 80 },
    isAnonymous: { type: Boolean, default: false },
    quote: {
      type: String,
      required: [true, 'Quote is required'],
      trim: true,
      maxlength: [1200, 'Quote cannot exceed 1200 characters'],
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: 5,
    },
    images: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
      },
    ],
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: false,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    source: {
      type: String,
      enum: ['public_link', 'admin'],
      default: 'public_link',
    },
    isActive: { type: Boolean, default: false },
    showOnHome: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

testimonialSchema.index({ status: 1, isActive: 1, showOnHome: 1, sortOrder: 1, createdAt: -1 });

const Testimonial = mongoose.model<ITestimonial>('Testimonial', testimonialSchema);
export default Testimonial;
