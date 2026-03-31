import { Request } from 'express';
import { Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
  googleId?: string;
  emailVerified?: boolean;
  phone?: string;
  avatar?: string;
  addresses: IAddress[];
  isActive: boolean;
  passwordChangedAt?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  changedPasswordAfter(JWTTimestamp: number): boolean;
}

export interface IAddress {
  _id?: Types.ObjectId;
  name: string;
  phone: string;
  label: string;
  street: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
}

export interface IProductVariant {
  size?: string;
  color?: string;
  colorCode?: string;
  stock: number;
  sku: string;
  price?: number;
}

export interface IProductCustomField {
  _id?: Types.ObjectId;
  label: string;
  placeholder?: string;
  fieldType: 'text' | 'textarea' | 'select' | 'image';
  options?: string[];
  isRequired: boolean;
}

export interface IProductDetail {
  key: string;
  value: string;
}

export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  shortDescription?: string;
  price: number;
  comparePrice?: number;
  category: string;
  subcategory?: string;
  fabric?: string;
  images: IProductImage[];
  variants: IProductVariant[];
  totalStock: number;
  tags: string[];
  isFeatured: boolean;
  isActive: boolean;
  // Gifting
  isGiftable: boolean;
  isCustomizable: boolean;
  minOrderQty: number;
  giftOccasions: string[];
  customFields: IProductCustomField[];
  productDetails?: IProductDetail[];
  ratings: {
    average: number;
    count: number;
  };
  /** PDP views (incremented client-side, once per session per product) */
  viewCount: number;
  /** Checkout frequency tracker */
  soldCount: number;
  seoTitle?: string;
  seoDescription?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductImage {
  url: string;
  publicId: string;
  alt?: string;
}

export interface ICartItem {
  product: Types.ObjectId;
  variant: {
    size?: string;
    color?: string;
    colorCode?: string;
    sku: string;
  };
  quantity: number;
  price: number;
  customFieldAnswers?: { label: string; value: string }[] | string; // Gifting (string when receiving from frontend)
}

export interface ICart extends Document {
  user: Types.ObjectId;
  items: ICartItem[];
  coupon?: Types.ObjectId;
  subtotal: number;
  discount: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrderItem {
  product: Types.ObjectId;
  name: string;
  image: string;
  variant: {
    size?: string;
    color?: string;
    sku: string;
  };
  quantity: number;
  price: number;
  customFieldAnswers?: { label: string; value: string }[]; // Gifting
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  orderNumber: string;
  user: Types.ObjectId;
  items: IOrderItem[];
  shippingAddress: IAddress;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  paymentMethod: 'razorpay' | 'cod';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  subtotal: number;
  discount: number;
  shippingCharge: number;
  tax: number;
  total: number;
  coupon?: Types.ObjectId;
  notes?: string;
  statusHistory: { status: string; timestamp: Date; note?: string }[];
  shippingCarrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  productType: 'standard' | 'custom';
  customRequestId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReview extends Document {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  user: Types.ObjectId;
  order: Types.ObjectId;
  rating: number;
  title?: string;
  comment: string;
  images?: { url: string; publicId: string }[];
  isVerifiedPurchase: boolean;
  helpfulVotes: Types.ObjectId[];
  reports?: {
    user: Types.ObjectId;
    reason: 'spam' | 'abusive' | 'misleading' | 'other';
    details?: string;
    createdAt: Date;
  }[];
  reportCount?: number;
  adminReply?: { text: string; createdAt: Date };
  createdAt: Date;
  updatedAt: Date;
}

export interface ICoupon extends Document {
  _id: Types.ObjectId;
  isValid: (
    userId: string,
    orderAmount: number,
    opts?: { completedOrders?: number }
  ) => { valid: boolean; message?: string };
  calculateDiscount: (orderAmount: number) => number;
  code: string;
  description?: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number;
  usageLimit?: number;
  usedCount: number;
  userUsageLimit: number;
  usedBy: { user: Types.ObjectId; usedAt: Date }[];
  startDate: Date;
  expiryDate: Date;
  isActive: boolean;
  applicableCategories: string[];
  eligibilityType: 'all' | 'first_order' | 'returning';
  minCompletedOrders: number;
  maxCompletedOrders?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBlogImage {
  url: string;
  publicId: string;
  caption?: string;
}

export interface IBlog extends Document {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  content: string;
  images: IBlogImage[];
  author: Types.ObjectId;
  likes: Types.ObjectId[];
  isPublished: boolean;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBlogComment extends Document {
  _id: Types.ObjectId;
  blog: Types.ObjectId;
  user: Types.ObjectId;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthRequest extends Request {
  user?: IUser;
}

export interface JwtPayload {
  id: string;
  iat: number;
  exp: number;
}

export type UserRole = 'user' | 'admin';

export interface IGiftingRequestItem {
  product: Types.ObjectId;
  name: string;
  quantity: number;
  customFieldAnswers: { fieldId: string; label: string; value: string }[];
}

export interface IGiftingRequest extends Document {
  _id: Types.ObjectId;
  user?: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  occasion: string;
  items: IGiftingRequestItem[];
  recipientMessage?: string;
  customizationNote?: string;
  packagingPreference: 'standard' | 'premium' | 'custom';
  customPackagingNote?: string;
  referenceImages?: { url: string; publicId: string }[];
  status: 'new' | 'price_quoted' | 'approved_by_user' | 'rejected_by_user' | 'cancelled';
  proposedPrice?: number;
  quotedPrice?: number;
  deliveryTime?: string;
  adminNote?: string;
  linkedOrderId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
