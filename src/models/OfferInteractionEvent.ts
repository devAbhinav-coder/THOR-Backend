import { Schema, model } from 'mongoose';

export type OfferInteractionEventType =
  | 'popup_impression'
  | 'popup_dismiss'
  | 'popup_cta_click'
  | 'coupon_copy';

export type OfferInteractionKind = 'coupon' | 'sale' | 'promotion';

const offerInteractionEventSchema = new Schema(
  {
    eventType: {
      type: String,
      enum: ['popup_impression', 'popup_dismiss', 'popup_cta_click', 'coupon_copy'],
      required: true,
      index: true,
    },
    offerKind: {
      type: String,
      enum: ['coupon', 'sale', 'promotion'],
      required: true,
      index: true,
    },
    offerId: { type: String, trim: true, index: true },
    offerLabel: { type: String, trim: true, maxlength: 200 },
    sessionKey: { type: String, required: true, trim: true, index: true },
    visitDate: { type: String, required: true, trim: true, index: true },
    path: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

offerInteractionEventSchema.index({ visitDate: 1, eventType: 1, offerKind: 1 });

const OfferInteractionEvent = model('OfferInteractionEvent', offerInteractionEventSchema);

export default OfferInteractionEvent;
