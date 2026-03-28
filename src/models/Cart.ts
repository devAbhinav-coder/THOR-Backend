import mongoose, { Schema } from 'mongoose';
import { ICart } from '../types';

const cartItemSchema = new Schema({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variant: {
    size: String,
    color: String,
    colorCode: String,
    sku: { type: String, required: true },
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
  },
  { timestamps: true }
);

cartSchema.pre<ICart>('save', function (next) {
  this.subtotal = this.items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  this.total = this.subtotal - this.discount;
  next();
});

// user index is already created by unique:true on the field

const Cart = mongoose.model<ICart>('Cart', cartSchema);
export default Cart;
