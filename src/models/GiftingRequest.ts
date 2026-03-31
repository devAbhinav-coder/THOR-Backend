import mongoose, { Schema } from 'mongoose';
import { IGiftingRequest } from '../types';

const customFieldAnswerSchema = new Schema({
  fieldId: { type: String, required: true },
  label: { type: String, required: true },
  value: { type: String, required: true },
}, { _id: false });

const giftingRequestItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  customFieldAnswers: [customFieldAnswerSchema],
}, { _id: false });

const giftingRequestSchema = new Schema<IGiftingRequest>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    occasion: { type: String, required: true, trim: true },
    items: [giftingRequestItemSchema],
    recipientMessage: { type: String, maxlength: 500 },
    customizationNote: { type: String, maxlength: 1000 },
    packagingPreference: {
      type: String,
      enum: ['standard', 'premium', 'custom'],
      default: 'standard',
    },
    customPackagingNote: { type: String, maxlength: 500 },
    referenceImages: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
      },
    ],
    status: {
      type: String,
      enum: ['new', 'price_quoted', 'approved_by_user', 'rejected_by_user', 'cancelled'],
      default: 'new',
    },
    proposedPrice: { type: Number },
    quotedPrice: { type: Number },
    deliveryTime: { type: String },
    adminNote: { type: String },
    linkedOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  },
  { timestamps: true }
);

giftingRequestSchema.index({ status: 1, createdAt: -1 });
giftingRequestSchema.index({ user: 1 });

export default mongoose.model<IGiftingRequest>('GiftingRequest', giftingRequestSchema);
