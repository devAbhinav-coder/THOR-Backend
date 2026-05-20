import mongoose, { Schema } from 'mongoose';
import { ICart } from '../types';

const cartItemSchema = new Schema({
  cartItemId: { type: String, required: true, index: true },
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  productName: { type: String, required: true },
  productSlug: { type: String, required: true },
  productImage: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  variant: {
    size: String,
    color: String,
    colorCode: String,
    sku: { type: String, required: true },
    stock: { type: Number, default: 0 },
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
    max: [10, 'Cannot add more than 10 of same item'],
  },
  price: {
    type: Number,
    required: true,
  },
  customFieldAnswers: [
    {
      label: { type: String, required: true },
      value: { type: String, required: true },
    },
  ],
  customizationHash: { type: String },
});

const cartSchema = new Schema<ICart>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: [cartItemSchema],
    coupon: {
      type: Schema.Types.ObjectId,
      ref: 'Coupon',
    },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    /** Optimistic concurrency for mutation safety. */
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// user index is already created by unique:true on the field

const Cart = mongoose.model<ICart>('Cart', cartSchema);
export default Cart;
