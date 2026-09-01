import { Schema, model, Document, Types } from "mongoose";

export type WhatsAppMessageCategory =
  | "order_confirm"
  | "order_status"
  | "order_cancelled"
  | "order_shipped"
  | "order_delivered"
  | "order_cancelled"
  | "offline_thankyou"
  | "offline_handover"
  | "abandoned_cart"
  | "review_invite"
  | "catalog_alert"
  | "marketing_campaign"
  | "test"
  | "other";

export type WhatsAppMessageStatus = "queued" | "sent" | "failed";

export interface IWhatsAppMessageLog extends Document {
  to: string;
  template: string;
  category: WhatsAppMessageCategory;
  status: WhatsAppMessageStatus;
  bodyParams?: string[];
  userId?: Types.ObjectId | null;
  orderId?: Types.ObjectId | null;
  campaignSubject?: string;
  metaMessageId?: string;
  errorMessage?: string;
  queuedAt: Date;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const whatsAppMessageLogSchema = new Schema<IWhatsAppMessageLog>(
  {
    to: { type: String, required: true, index: true },
    template: { type: String, required: true },
    category: {
      type: String,
      enum: [
        "order_confirm",
        "order_status",
        "order_cancelled",
        "order_shipped",
        "order_delivered",
        "order_cancelled",
        "offline_thankyou",
        "offline_handover",
        "abandoned_cart",
        "review_invite",
        "catalog_alert",
        "marketing_campaign",
        "test",
        "other",
      ],
      default: "other",
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "sent", "failed"],
      default: "queued",
      index: true,
    },
    bodyParams: [String],
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    campaignSubject: String,
    metaMessageId: String,
    errorMessage: String,
    queuedAt: { type: Date, default: Date.now },
    sentAt: Date,
  },
  { timestamps: true },
);

whatsAppMessageLogSchema.index({ createdAt: -1 });
whatsAppMessageLogSchema.index({ category: 1, status: 1, createdAt: -1 });
whatsAppMessageLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);

const WhatsAppMessageLog = model<IWhatsAppMessageLog>(
  "WhatsAppMessageLog",
  whatsAppMessageLogSchema,
);
export default WhatsAppMessageLog;
