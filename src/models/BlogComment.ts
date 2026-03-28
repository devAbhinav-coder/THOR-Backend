import mongoose, { Schema } from 'mongoose';
import { IBlogComment } from '../types';

const blogCommentSchema = new Schema<IBlogComment>(
  {
    blog: {
      type: Schema.Types.ObjectId,
      ref: 'Blog',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: [true, 'Comment content is required'],
      trim: true,
      maxlength: [1000, 'Comment cannot exceed 1000 characters'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexing
blogCommentSchema.index({ blog: 1, createdAt: -1 });

const BlogComment = mongoose.model<IBlogComment>('BlogComment', blogCommentSchema);
export default BlogComment;
