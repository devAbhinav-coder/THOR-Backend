import mongoose, { Schema } from "mongoose";

export type NewsletterSource = "blog_listing" | "blog_detail";

export interface INewsletterSubscriber extends mongoose.Document {
  email: string;
  source: NewsletterSource;
  isActive: boolean;
  unsubscribedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const newsletterSubscriberSchema = new Schema<INewsletterSubscriber>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 120,
      match: [/^\S+@\S+\.\S+$/, "Invalid email"],
    },
    source: {
      type: String,
      enum: ["blog_listing", "blog_detail"],
      default: "blog_listing",
    },
    isActive: { type: Boolean, default: true },
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

newsletterSubscriberSchema.index({ createdAt: -1 });
newsletterSubscriberSchema.index({ isActive: 1, createdAt: -1 });

const NewsletterSubscriber =
  mongoose.models.NewsletterSubscriber ||
  mongoose.model<INewsletterSubscriber>(
    "NewsletterSubscriber",
    newsletterSubscriberSchema,
  );

export default NewsletterSubscriber;
