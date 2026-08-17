import { Request } from 'express';
import { Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
  googleId?: string;
  /** Set when a welcome email was sent (OTP verify or new Google account). */
  welcomeEmailAt?: Date;
  emailVerified?: boolean;
  phone?: string;
  avatar?: string;
  adminNote?: string;
  addresses: IAddress[];
  isActive: boolean;
  /** Auto-created from offline order; cleared when the customer claims the account. */
  offlineLead?: boolean;
  lastActiveAt?: Date;
  reengagementEmailAt?: Date;
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
  /** House / flat / building details (separate from street/area). */
  house?: string;
  street: string;
  /** Nearby landmark to help couriers (optional, India-style). */
  landmark?: string;
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
  /** Purchase / landed cost per unit — used for margin calculation in inventory hub. */
  costPrice?: number;
  /** Lifetime units sold for this SKU. */
  soldCount?: number;
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
  /** FK reference to Category — populated during Phase 2 migration */
  categoryId?: Types.ObjectId;
  subcategory?: string;
  /** FK reference to SubCategory — populated during Phase 2 migration */
  subcategoryId?: Types.ObjectId;
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
  occasions: string[];
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
  /** Vector search embedding — not selected by default in queries */
  contentEmbedding?: number[];
  discountPercent?: number;
  hsnCode?: string;
  seoTitle?: string;
  seoDescription?: string;
  /** Admin-controlled sort position within a category/subcategory listing */
  sortOrder?: number;
  /** Old slug stored before Phase 3 slug regeneration — used for 301 redirects */
  oldSlug?: string;
  createdAt: Date;
  updatedAt: Date;
}


export interface IProductImage {
  url: string;
  publicId: string;
  alt?: string;
  color?: string;
}

export interface ICartItem {
  cartItemId: string;
  product: Types.ObjectId;
  productName: string;
  productSlug: string;
  productImage: string;
  isActive: boolean;
  variant: {
    size?: string;
    color?: string;
    colorCode?: string;
    sku: string;
    stock?: number;
  };
  quantity: number;
  price: number;
  customFieldAnswers?: { label: string; value: string }[] | string; // Gifting (string when receiving from frontend)
  customizationHash?: string;
}

export interface ICart extends Document {
  user: Types.ObjectId;
  items: ICartItem[];
  coupon?: Types.ObjectId;
  subtotal: number;
  discount: number;
  total: number;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrderItem {
  product: Types.ObjectId;
  name: string;
  slug: string;
  image: string;
  variant: {
    size?: string;
    color?: string;
    sku: string;
  };
  quantity: number;
  price: number;
  /** Category label at time of sale (for offline manual + reporting). */
  lineCategory?: string;
  lineCategoryId?: Types.ObjectId;
  isOfflineManual?: boolean;
  /** Unit purchase cost frozen at sale time (COGS per unit). */
  costAtSale?: number;
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
  paymentMethod: 'razorpay' | 'cod' | 'offline_upi' | 'offline_cash';
  offlineMeta?: {
    source: 'stall' | 'personal_contact' | 'b2b';
    fulfillment: 'delhivery' | 'offline_handover';
    createdByAdmin?: Types.ObjectId;
  };
  b2bMeta?: {
    companyName?: string;
    gstin?: string;
    poNumber?: string;
  };
  /** First-touch UTM / Meta click id captured at checkout */
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
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  subtotal: number;
  discount: number;
  /** Admin sale campaign savings vs catalog list price (informational). */
  saleDiscount?: number;
  /** Auto-offer (promotion) discount at checkout. */
  promotionDiscount?: number;
  /** Coupon code discount at checkout. */
  couponDiscount?: number;
  promotion?: Types.ObjectId;
  shippingCharge: number;
  codFee?: number;
  tax: number;
  total: number;
  coupon?: Types.ObjectId;
  /** Browser tab session (`hor_sv`) for popup ↔ order attribution. */
  shopSessionKey?: string;
  notes?: string;
  statusHistory: { status: string; timestamp: Date; note?: string }[];
  shippingCarrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  productType: 'standard' | 'custom';
  customRequestId?: Types.ObjectId;
  invoice?: {
    isGenerated: boolean;
    generatedAt?: Date;
  };
  taxSalesInvoiceId?: Types.ObjectId;
  returnStatus?: 'none' | 'requested' | 'approved' | 'rejected' | 'returned';
  returnRequest?: {
    reason: string;
    note?: string;
    refundMethod?: 'original_payment' | 'upi' | 'bank_transfer';
    userBankDetails?: {
      upiId?: string;
      accountName?: string;
      accountNumber?: string;
      ifscCode?: string;
      bankName?: string;
    };
    requestedAt: Date;
    resolvedAt?: Date;
    adminNote?: string;
  };
  refundData?: {
    amount: number;
    method: 'razorpay_auto' | 'cash' | 'bank_transfer' | 'upi_manual';
    gatewayRefundId?: string;
    notes?: string;
    processedAt: Date;
    nonRefundableFees?: number;
  };
  /** Populated by Delhivery integration (Mixed in MongoDB) */
  delhivery?: Record<string, unknown>;
  /**
   * True when stock has been decremented for this order (at checkout intent or COD creation).
   * Used as the authoritative flag for restock-on-cancel decisions.
   * Replaces payment-method heuristics for orders created after this field was introduced.
   */
  inventoryReserved?: boolean;
  reviewInviteSkippedAt?: Date;
  /** When admin SLA breach alert was last sent for this order. */
  slaAlertedAt?: Date;
  deliveryInvoiceEmailSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ReviewStatus = 'visible' | 'hidden' | 'flagged' | 'pending_moderation';

export interface IReview extends Document {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  user: Types.ObjectId;
  order?: Types.ObjectId;
  source?: 'purchase' | 'share_link' | 'invite';
  rating: number;
  title?: string;
  comment: string;
  images?: { url: string; publicId: string }[];
  isVerifiedPurchase: boolean;
  helpfulVotes: Types.ObjectId[];
  helpfulCount?: number;
  userSnapshot?: { name?: string; avatar?: string };
  status?: ReviewStatus;
  deletedAt?: Date | null;
  moderationFlags?: string[];
  moderationScore?: number;
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

export type PromoScopeType = 'all' | 'categories' | 'subcategories' | 'products';

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
  displayTitle?: string;
  imageUrl?: string;
  imagePublicId?: string;
  showOnStorefront: boolean;
  discountType: 'percentage' | 'flat' | 'fixed';
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
  deletedAt?: Date | null;
  archivedAt?: Date | null;
  scopeType: PromoScopeType;
  applicableCategories: string[];
  applicableCategoryIds: Types.ObjectId[];
  applicableSubcategoryIds: Types.ObjectId[];
  applicableProductIds: Types.ObjectId[];
  eligibilityType: 'all' | 'first_order' | 'returning';
  minCompletedOrders: number;
  maxCompletedOrders?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISaleCampaign extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  badgeText?: string;
  discountType: 'percentage' | 'flat' | 'fixed';
  discountValue: number;
  maxDiscountPerItem?: number;
  imageUrl?: string;
  imagePublicId?: string;
  showOnStorefront?: boolean;
  scopeType: PromoScopeType;
  categoryIds: Types.ObjectId[];
  subcategoryIds: Types.ObjectId[];
  productIds: Types.ObjectId[];
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  deletedAt?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPromotion extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  termsAndConditions?: string;
  displayTitle?: string;
  badgeText?: string;
  imageUrl?: string;
  imagePublicId?: string;
  promotionType: 'bogo' | 'flat' | 'percentage';
  buyQuantity: number;
  getQuantity: number;
  getDiscountPercent: number;
  discountValue?: number;
  maxDiscountAmount?: number;
  minOrderAmount?: number;
  scopeType: PromoScopeType;
  categoryIds: Types.ObjectId[];
  subcategoryIds: Types.ObjectId[];
  productIds: Types.ObjectId[];
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  showOnStorefront: boolean;
  priority: number;
  deletedAt?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type BlogImageLayout =
  | 'hero'
  | 'wide'
  | 'portrait'
  | 'square'
  | 'inline'
  | 'split';

export type BlogImagePlacement = 'cover' | 'article' | 'gallery';

export interface IBlogImage {
  url: string;
  publicId: string;
  caption?: string;
  layout?: BlogImageLayout;
  placement?: BlogImagePlacement;
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
  excerpt?: string;
  seoTitle?: string;
  seoDescription?: string;
  keywords: string[];
  tags: string[];
  category: string;
  relatedProductIds: Types.ObjectId[];
  readingTimeMin: number;
  aiGenerated: boolean;
  aiPromptSnapshot?: string;
  contentEmbedding?: number[];
  scheduledPublishAt?: Date | null;
  shopClickCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type BlogContentPlanStatus = 'planned' | 'drafted' | 'published' | 'skipped';

export interface IBlogContentPlan extends Document {
  _id: Types.ObjectId;
  topic: string;
  keywords: string[];
  category: string;
  plannedDate: Date;
  status: BlogContentPlanStatus;
  notes?: string;
  blog?: Types.ObjectId;
  createdBy: Types.ObjectId;
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
  acceptIdempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}
