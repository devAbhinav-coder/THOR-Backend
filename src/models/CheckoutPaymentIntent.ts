import { Schema, model, type Types } from "mongoose";

/** One line for inventory decrement at payment success. */
export type CheckoutIntentStockLine = {
  productId: string;
  sku: string;
  quantity: number;
};

/** Matches `buildOrderItemsFromProducts` output — persisted on the intent for post-pay Order.create. */
export type CheckoutIntentSnapshotItem = {
  product: Types.ObjectId;
  name: string;
  slug: string;
  image: string;
  variant: {
    sku: string;
    size?: string;
    color?: string;
    colorCode?: string;
  };
  quantity: number;
  price: number;
  customFieldAnswers?: { label: string; value: string }[];
};

/** Snapshot persisted until Razorpay payment succeeds — no Order row until then. */
export type CheckoutIntentSnapshot = {
  shippingAddress: Record<string, unknown>;
  items: CheckoutIntentSnapshotItem[];
  stockLines: CheckoutIntentStockLine[];
  subtotal: number;
  discount: number;
  shippingCharge: number;
  codFee: number;
  tax: number;
  total: number;
  coupon?: Types.ObjectId;
  notes?: string;
  cartIdToDelete?: Types.ObjectId;
  marketingAttribution?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    fbclid?: string;
    landingPath?: string;
    capturedAt?: Date;
  };
};

export interface ICheckoutPaymentIntent {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  razorpayOrderId: string;
  expiresAt: Date;
  consumedAt?: Date;
  createdOrderId?: Types.ObjectId;
  /** Incremented on each verify attempt (support / abuse signals). */
  verifyAttempts?: number;
  lastVerifyAttemptAt?: Date;
  snapshot: CheckoutIntentSnapshot;
  createdAt: Date;
  updatedAt: Date;
}

const stockLineSchema = new Schema(
  {
    productId: { type: String, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const snapshotVariantSchema = new Schema(
  {
    size: { type: String },
    color: { type: String },
    colorCode: { type: String },
    sku: { type: String, required: true },
  },
  { _id: false },
);

const snapshotItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    image: { type: String, required: true },
    variant: { type: snapshotVariantSchema, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    customFieldAnswers: [
      {
        label: { type: String, required: true },
        value: { type: String, required: true },
      },
    ],
  },
  { _id: false },
);

const checkoutPaymentIntentSchema = new Schema<ICheckoutPaymentIntent>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    /** TTL index — MongoDB auto-deletes expired intents. */
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date },
    createdOrderId: { type: Schema.Types.ObjectId, ref: "Order" },
    verifyAttempts: { type: Number, default: 0 },
    lastVerifyAttemptAt: { type: Date },
    snapshot: {
      type: new Schema(
        {
          shippingAddress: { type: Schema.Types.Mixed, required: true },
          items: { type: [snapshotItemSchema], required: true },
          stockLines: { type: [stockLineSchema], required: true },
          subtotal: { type: Number, required: true },
          discount: { type: Number, default: 0 },
          shippingCharge: { type: Number, default: 0 },
          codFee: { type: Number, default: 0 },
          tax: { type: Number, default: 0 },
          total: { type: Number, required: true },
          coupon: { type: Schema.Types.ObjectId, ref: "Coupon" },
          notes: { type: String },
          cartIdToDelete: { type: Schema.Types.ObjectId, ref: "Cart" },
          marketingAttribution: {
            utmSource: { type: String, trim: true, maxlength: 120 },
            utmMedium: { type: String, trim: true, maxlength: 120 },
            utmCampaign: { type: String, trim: true, maxlength: 200 },
            utmContent: { type: String, trim: true, maxlength: 200 },
            utmTerm: { type: String, trim: true, maxlength: 200 },
            fbclid: { type: String, trim: true, maxlength: 200 },
            landingPath: { type: String, trim: true, maxlength: 200 },
            capturedAt: { type: Date },
          },
        },
        { _id: false },
      ),
      required: true,
    },
  },
  { timestamps: true },
);

// TTL index: MongoDB auto-removes expired checkout intents
checkoutPaymentIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const CheckoutPaymentIntent = model<ICheckoutPaymentIntent>(
  "CheckoutPaymentIntent",
  checkoutPaymentIntentSchema,
);

export default CheckoutPaymentIntent;
