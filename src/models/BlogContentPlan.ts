import mongoose, { Schema } from 'mongoose';
import { IBlogContentPlan } from '../types';

const blogContentPlanSchema = new Schema<IBlogContentPlan>(
  {
    topic: {
      type: String,
      required: [true, 'Topic is required'],
      trim: true,
      maxlength: 300,
    },
    keywords: { type: [String], default: [] },
    category: { type: String, default: 'saree-styling', trim: true },
    plannedDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['planned', 'drafted', 'published', 'skipped'],
      default: 'planned',
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    blog: { type: Schema.Types.ObjectId, ref: 'Blog' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

blogContentPlanSchema.index({ plannedDate: 1, status: 1 });
blogContentPlanSchema.index({ createdBy: 1, plannedDate: -1 });

const BlogContentPlan = mongoose.model<IBlogContentPlan>(
  'BlogContentPlan',
  blogContentPlanSchema,
);
export default BlogContentPlan;
