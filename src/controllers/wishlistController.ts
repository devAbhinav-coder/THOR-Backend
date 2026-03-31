import { Response, NextFunction } from 'express';
import Wishlist from '../models/Wishlist';
import Product from '../models/Product';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export const getWishlist = catchAsync(async (req: AuthRequest, res: Response) => {
  const wishlist = await Wishlist.findOne({ user: req.user!._id }).populate({
    path: 'products',
    select: 'name slug images price comparePrice ratings category isActive',
    match: { isActive: true },
  });

  sendSuccess(res, { products: wishlist?.products || [] });
});

export const toggleWishlist = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { productId } = req.params;

  const product = await Product.findById(productId);
  if (!product) return next(new AppError('Product not found.', 404));

  let wishlist = await Wishlist.findOne({ user: req.user!._id });

  if (!wishlist) {
    wishlist = new Wishlist({ user: req.user!._id, products: [] });
  }

  const productIndex = wishlist.products.findIndex((id) => id.toString() === productId);
  let action: string;

  if (productIndex > -1) {
    wishlist.products.splice(productIndex, 1);
    action = 'removed';
  } else {
    wishlist.products.push(product._id);
    action = 'added';
  }

  await wishlist.save();

  sendSuccess(res, { wishlistCount: wishlist.products.length, action });
});
