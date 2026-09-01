import mongoose, { Schema } from 'mongoose';
import { IBlog } from '../types';

const blogSchema = new Schema<IBlog>(
  {
    title: {
      type: String,
      required: [true, 'Blog title is required'],
      trim: true,
      maxlength: [150, 'Title cannot exceed 150 characters'],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    /** Previous slug — used for 301 redirects when slug is edited. */
    oldSlug: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
    },
    content: {
      type: String,
      required: [true, 'Blog content is required'],
    },
    images: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
        caption: { type: String, trim: true },
        layout: {
          type: String,
          enum: ['hero', 'wide', 'portrait', 'square', 'inline', 'split'],
          default: 'inline',
        },
        placement: {
          type: String,
          enum: ['cover', 'article', 'gallery'],
          default: 'article',
        },
      },
    ],
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    likes: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isPublished: {
      type: Boolean,
      default: false,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    excerpt: {
      type: String,
      trim: true,
      maxlength: [220, 'Excerpt cannot exceed 220 characters'],
    },
    seoTitle: {
      type: String,
      trim: true,
      maxlength: [70, 'SEO title cannot exceed 70 characters'],
    },
    seoDescription: {
      type: String,
      trim: true,
      maxlength: [170, 'SEO description cannot exceed 170 characters'],
    },
    keywords: {
      type: [String],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    category: {
      type: String,
      trim: true,
      default: 'saree-styling',
    },
    articleTemplate: {
      type: String,
      enum: ['classic', 'magazine', 'minimal', 'lookbook'],
      default: 'classic',
    },
    relatedProductIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    readingTimeMin: {
      type: Number,
      default: 1,
      min: 1,
    },
    aiGenerated: {
      type: Boolean,
      default: false,
    },
    aiPromptSnapshot: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    contentEmbedding: {
      type: [Number],
      default: [],
      select: false,
    },
    scheduledPublishAt: {
      type: Date,
      default: null,
    },
    shopClickCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexing for faster searches
blogSchema.index({ isPublished: 1, createdAt: -1 });
blogSchema.index({ isPublished: 1, category: 1, createdAt: -1 });
blogSchema.index({ isPublished: 1, tags: 1 });
blogSchema.index({ isPublished: 1, scheduledPublishAt: 1 });
blogSchema.index({ viewCount: -1 });
blogSchema.index({ oldSlug: 1 }, { sparse: true });
// Text index for full-text search on title and content (avoids full collection regex scans)
blogSchema.index({ title: 'text', content: 'text', excerpt: 'text' });

const Blog = mongoose.model<IBlog>('Blog', blogSchema);
export default Blog;
