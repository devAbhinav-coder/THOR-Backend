import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWishlist extends Document {
  user: Types.ObjectId;
  products: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const wishlistSchema = new Schema<IWishlist>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    products: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: 'Product',
        },
      ],
      validate: {
        validator(v: Types.ObjectId[]) {
          return !v || v.length <= 500;
        },
        message: 'Wishlist cannot exceed 500 items',
      },
    },
  },
  { timestamps: true }
);

// user index is already created by unique:true on the field
// products array is only queried via user id; no separate index needed on products

const Wishlist = mongoose.model<IWishlist>('Wishlist', wishlistSchema);
export default Wishlist;
