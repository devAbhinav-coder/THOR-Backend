import { Schema, model, type Types } from "mongoose";

/** One line for inventory decrement at payment success. */
export type CheckoutIntentStockLine = {
  productId: string;
  sku: string;
  quantity: number;
};

/** Snapshot persisted until Razorpay payment succeeds — no Order row until then. */
export type CheckoutIntentSnapshot = {
  shippingAddress: Record<string, unknown>;
  items: unknown[];
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
};

export interface ICheckoutPaymentIntent {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  razorpayOrderId: string;
  expiresAt: Date;
  consumedAt?: Date;
  createdOrderId?: Types.ObjectId;
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

const checkoutPaymentIntentSchema = new Schema<ICheckoutPaymentIntent>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date },
    createdOrderId: { type: Schema.Types.ObjectId, ref: "Order" },
    snapshot: {
      type: new Schema(
        {
          shippingAddress: { type: Schema.Types.Mixed, required: true },
          items: { type: [Schema.Types.Mixed], required: true },
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
        },
        { _id: false },
      ),
      required: true,
    },
  },
  { timestamps: true },
);

const CheckoutPaymentIntent = model<ICheckoutPaymentIntent>(
  "CheckoutPaymentIntent",
  checkoutPaymentIntentSchema,
);

export default CheckoutPaymentIntent;
