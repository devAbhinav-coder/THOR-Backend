import { Response, NextFunction } from 'express';
import Cart from '../models/Cart';
import Product from '../models/Product';
import Coupon from '../models/Coupon';
import Order from '../models/Order';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';

export const getCart = catchAsync(async (req: AuthRequest, res: Response) => {
  const cart = await Cart.findOne({ user: req.user!._id })
    .populate({
      path: 'items.product',
      select: 'name images price isActive',
    })
    .populate({
      path: 'coupon',
      select: 'code',
    });

  if (!cart) {
    res.status(200).json({
      status: 'success',
      data: { cart: { items: [], subtotal: 0, discount: 0, total: 0 } },
    });
    return;
  }

  res.status(200).json({
    status: 'success',
    data: { cart },
  });
});

export const addToCart = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { productId, variant, quantity } = req.body;

  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    return next(new AppError('Product not found or unavailable.', 404));
  }

  const productVariant = product.variants.find((v) => v.sku === variant.sku);
  if (!productVariant) {
    return next(new AppError('Selected variant not found.', 404));
  }

  if (productVariant.stock < quantity) {
    return next(new AppError(`Only ${productVariant.stock} items available in stock.`, 400));
  }

  const itemPrice = productVariant.price || product.price;

  let cart = await Cart.findOne({ user: req.user!._id });

  if (!cart) {
    cart = new Cart({ user: req.user!._id, items: [] });
  }

  const existingItemIndex = cart.items.findIndex((item) => item.variant.sku === variant.sku);

  if (existingItemIndex > -1) {
    const newQty = cart.items[existingItemIndex].quantity + quantity;
    if (newQty > productVariant.stock) {
      return next(new AppError(`Only ${productVariant.stock} items available in stock.`, 400));
    }
    cart.items[existingItemIndex].quantity = newQty;
  } else {
    cart.items.push({
      product: product._id,
      variant,
      quantity,
      price: itemPrice,
    });
  }

  await cart.save();

  const populatedCart = await Cart.findById(cart._id).populate({
    path: 'items.product',
    select: 'name images price',
  });

  res.status(200).json({
    status: 'success',
    data: { cart: populatedCart },
  });
});

export const updateCartItem = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { sku } = req.params;
  const { quantity } = req.body;

  const cart = await Cart.findOne({ user: req.user!._id });
  if (!cart) return next(new AppError('Cart not found.', 404));

  const itemIndex = cart.items.findIndex((item) => item.variant.sku === sku);
  if (itemIndex === -1) return next(new AppError('Item not found in cart.', 404));

  const product = await Product.findById(cart.items[itemIndex].product);
  if (!product) return next(new AppError('Product not found.', 404));

  const variant = product.variants.find((v) => v.sku === sku);
  if (!variant) return next(new AppError('Variant not found.', 404));

  if (quantity > variant.stock) {
    return next(new AppError(`Only ${variant.stock} items available.`, 400));
  }

  cart.items[itemIndex].quantity = quantity;
  await cart.save();

  res.status(200).json({
    status: 'success',
    data: { cart },
  });
});

export const removeFromCart = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { sku } = req.params;

  const cart = await Cart.findOne({ user: req.user!._id });
  if (!cart) return next(new AppError('Cart not found.', 404));

  cart.items = cart.items.filter((item) => item.variant.sku !== sku);
  await cart.save();

  res.status(200).json({
    status: 'success',
    data: { cart },
  });
});

export const clearCart = catchAsync(async (req: AuthRequest, res: Response) => {
  await Cart.findOneAndDelete({ user: req.user!._id });
  res.status(200).json({ status: 'success', message: 'Cart cleared' });
});

export const applyCoupon = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { couponCode } = req.body;

  const cart = await Cart.findOne({ user: req.user!._id });
  if (!cart || cart.items.length === 0) {
    return next(new AppError('Your cart is empty.', 400));
  }

  const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
  if (!coupon) return next(new AppError('Invalid coupon code.', 404));

  const completedOrders = await Order.countDocuments({ user: req.user!._id, status: 'delivered' });
  const validity = (
    coupon as typeof coupon & {
      isValid: (
        userId: string,
        amount: number,
        opts?: { completedOrders?: number }
      ) => { valid: boolean; message?: string };
    }
  ).isValid(String(req.user!._id), cart.subtotal, { completedOrders });
  if (!validity.valid) {
    return next(new AppError(validity.message || 'Coupon is not valid.', 400));
  }

  const discount = (coupon as typeof coupon & { calculateDiscount: (amount: number) => number }).calculateDiscount(cart.subtotal);
  cart.coupon = coupon._id;
  cart.discount = discount;
  cart.total = cart.subtotal - discount;
  await cart.save();

  res.status(200).json({
    status: 'success',
    data: {
      cart,
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        appliedDiscount: discount,
      },
    },
  });
});

export const removeCoupon = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const cart = await Cart.findOne({ user: req.user!._id });
  if (!cart) return next(new AppError('Cart not found.', 404));

  cart.coupon = undefined;
  cart.discount = 0;
  cart.total = cart.subtotal;
  await cart.save();

  res.status(200).json({ status: 'success', data: { cart } });
});
