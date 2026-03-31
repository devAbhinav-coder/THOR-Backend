import { Response, NextFunction } from 'express';
import Cart from '../models/Cart';
import Product from '../models/Product';
import Coupon from '../models/Coupon';
import Order from '../models/Order';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { safeJsonParse } from '../utils/safeJson';

const getGiftMinQty = (product: InstanceType<typeof Product>) => {
  const isCorporateGift = (product.giftOccasions || []).some(
    (o) => String(o).trim().toLowerCase() === 'corporate'
  );
  const baseMin = Math.max(Number(product.minOrderQty || 1), 1);
  return isCorporateGift ? Math.max(baseMin, 10) : baseMin;
};

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
    sendSuccess(res, { cart: { items: [], subtotal: 0, discount: 0, total: 0 } });
    return;
  }

  sendSuccess(res, { cart });
});

export const addToCart = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { productId, variant, quantity, customFieldAnswers } = req.body;
 
   const product = await Product.findById(productId);
   if (!product || !product.isActive) {
     return next(new AppError('Product not found or unavailable.', 404));
   }
 
   // Gifting: Check if it's customizable (Request Quote only)
   if (product.isCustomizable) {
     return next(new AppError('This product requires a customization request. Please use the "Customize & Request" button.', 400));
   }
 
   // Gifting: Enforce Min Order Qty (Corporate => at least 10)
   const minQty = getGiftMinQty(product as InstanceType<typeof Product>);
   if (quantity < minQty) {
     return next(new AppError(`Minimum order quantity for this item is ${minQty}.`, 400));
   }
 
   // Gifting: Verify Required Custom Fields
   if (product.customFields && product.customFields.length > 0) {
     const answers = safeJsonParse<{ label: string; value: string }[]>(
       customFieldAnswers,
       [],
       'customFieldAnswers'
     );
     for (const field of product.customFields) {
       if (field.isRequired) {
         const answer = answers.find((a) => a.label === field.label);
         if (!answer || !answer.value) {
           return next(new AppError(`Custom field "${field.label}" is required.`, 400));
         }
       }
     }
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
 
   // Match by SKU AND Custom Field Answers (if answers are different, it's a separate item)
   const parsedAnswers = safeJsonParse<{ label: string; value: string }[]>(
     customFieldAnswers,
     [],
     'customFieldAnswers'
   );
   
   const existingItemIndex = cart.items.findIndex((item) => {
     if (item.variant.sku !== variant.sku) return false;
     
     // Compare custom field answers
    const itemAnswers = (item.customFieldAnswers as { label: string; value: string }[]) || [];
     if (itemAnswers.length !== parsedAnswers.length) return false;
     
    return parsedAnswers.every((pa) =>
      itemAnswers.find((ia) => ia.label === pa.label && ia.value === pa.value)
    );
   });
 
   if (existingItemIndex > -1) {
     const newQty = cart.items[existingItemIndex].quantity + quantity;
    if (newQty < minQty) {
      return next(new AppError(`Minimum order quantity for this item is ${minQty}.`, 400));
    }
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
       customFieldAnswers: parsedAnswers
     });
   }

  await cart.save();

  const populatedCart = await Cart.findById(cart._id).populate({
    path: 'items.product',
    select: 'name images price',
  });

  sendSuccess(res, { cart: populatedCart });
});

export const uploadCustomFieldImage = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const uploaded = (req as AuthRequest & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;
  const first = uploaded?.[0];
  if (!first) {
    return next(new AppError('Please upload an image.', 400));
  }
  sendSuccess(res, { image: first }, 'Image uploaded');
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

  const minQty = getGiftMinQty(product as InstanceType<typeof Product>);
  if (quantity < minQty) {
    return next(new AppError(`Minimum order quantity for this item is ${minQty}.`, 400));
  }

  if (quantity > variant.stock) {
    return next(new AppError(`Only ${variant.stock} items available.`, 400));
  }

  cart.items[itemIndex].quantity = quantity;
  await cart.save();

  sendSuccess(res, { cart });
});

export const removeFromCart = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { sku } = req.params;

  const cart = await Cart.findOne({ user: req.user!._id });
  if (!cart) return next(new AppError('Cart not found.', 404));

  cart.items = cart.items.filter((item) => item.variant.sku !== sku);
  await cart.save();

  sendSuccess(res, { cart });
});

export const clearCart = catchAsync(async (req: AuthRequest, res: Response) => {
  await Cart.findOneAndDelete({ user: req.user!._id });
  sendSuccess(res, {}, 'Cart cleared');
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

  sendSuccess(res, {
    cart,
    coupon: {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      appliedDiscount: discount,
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

  sendSuccess(res, { cart });
});
