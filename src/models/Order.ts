import { Schema, model } from 'mongoose';
import { IOrder } from '../types';

const orderItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  image: { type: String, required: true },
  variant: {
    size: String,
    color: String,
    sku: { type: String, required: true },
  },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true },
  customFieldAnswers: [
    {
      label: { type: String, required: true },
      value: { type: String, required: true },
    },
  ],
});

const addressSchema = new Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  label: String,
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String, required: true },
  country: { type: String, default: 'India' },
});

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String,
      unique: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: [orderItemSchema],
    shippingAddress: { type: addressSchema, required: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    paymentMethod: {
      type: String,
      enum: ['razorpay', 'cod'],
      required: true,
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    shippingCharge: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    notes: String,
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
      },
    ],
    shippingCarrier: { type: String, trim: true },
    trackingNumber: { type: String, trim: true },
    trackingUrl: { type: String, trim: true },
    shippedAt: Date,
    deliveredAt: Date,
    productType: {
      type: String,
      enum: ['standard', 'custom'],
      default: 'standard',
    },
    invoice: {
      isGenerated: { type: Boolean, default: false },
      generatedAt: Date,
    },
    customRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'GiftingRequest',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const o = ret as Record<string, unknown>;
        delete o.razorpaySignature;
        return o;
      },
    },
    toObject: {
      transform: (_doc, ret) => {
        const o = ret as Record<string, unknown>;
        delete o.razorpaySignature;
        return o;
      },
    },
  }
);

orderSchema.pre<IOrder>('save', async function (next) {
  if (this.isNew) {
    const tsPart = Date.now().toString(36).toUpperCase();
    const randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    this.orderNumber = `HOR-${tsPart}-${randPart}`;
    this.statusHistory = [{ status: this.status, timestamp: new Date() }];
  }
  next();
});

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ razorpayOrderId: 1 });
// orderNumber index is already created by unique:true on the field

const Order = model<IOrder>('Order', orderSchema);
export default Order;
