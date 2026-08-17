import { Schema, model, Document } from 'mongoose';

export type BlogPublishOutboxStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'dead_letter';

export interface IBlogPublishOutbox extends Document {
  dedupeKey: string;
  blogId: string;
  scheduledPublishAt: Date;
  status: BlogPublishOutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const blogPublishOutboxSchema = new Schema<IBlogPublishOutbox>(
  {
    dedupeKey: { type: String, required: true, unique: true },
    blogId: { type: String, required: true, index: true },
    scheduledPublishAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'dead_letter'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    lastError: String,
    nextAttemptAt: { type: Date, default: Date.now },
    processedAt: Date,
  },
  { timestamps: true },
);

blogPublishOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
blogPublishOutboxSchema.index({ scheduledPublishAt: 1, status: 1 });

const BlogPublishOutbox = model<IBlogPublishOutbox>(
  'BlogPublishOutbox',
  blogPublishOutboxSchema,
);
export default BlogPublishOutbox;
