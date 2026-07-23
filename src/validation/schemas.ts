import { z } from 'zod';

// Helper: coerce "true"/"false" strings to booleans
const booleanFromString = z.preprocess(
  (val) => {
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
  },
  z.boolean()
);

const optionalBooleanFromString = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
  },
  z.boolean().optional()
);

// Helper: parse a JSON string into an array, or pass through if already an array
const jsonStringToArray = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.preprocess((val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
    return val;
  }, z.array(itemSchema));

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** Bcrypt uses at most 72 bytes; cap avoids confusion and DoS-y huge payloads. */
const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase and number');

const passwordWire = z
  .string()
  .min(1, 'Password is required')
  .max(128, 'Password is too long');

const emailField = z
  .string()
  .email('Invalid email address')
  .transform((v) => v.normalize('NFC').trim().toLowerCase());

const nameField = z
  .string()
  .min(2, 'Name must be at least 2 characters')
  .max(50)
  .transform((v) => v.normalize('NFC').trim().replace(/\s+/g, ' '));

const phoneInField = z
  .string()
  .transform((v) => v.replace(/\D/g, '').slice(-10))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

const otpField = z
  .string()
  .transform((v) => v.replace(/\D/g, '').slice(0, 6))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

/** Cloudflare Turnstile — optional until TURNSTILE_ENFORCE=true */
const turnstileTokenField = z.string().min(10).max(2048).optional();

export const signupStartSchema = z.object({
  body: z.object({
    name: nameField,
    email: emailField,
    phone: phoneInField,
    password: strongPassword,
    turnstileToken: turnstileTokenField,
  }),
});

export const signupVerifySchema = z.object({
  body: z.object({
    email: emailField,
    otp: otpField,
    turnstileToken: turnstileTokenField,
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailField,
    password: passwordWire,
    turnstileToken: turnstileTokenField,
  }),
});

export const updatePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: passwordWire,
      newPassword: strongPassword,
    })
    .refine((b) => b.currentPassword !== b.newPassword, {
      message: 'New password must be different from your current password',
      path: ['newPassword'],
    }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailField,
    turnstileToken: turnstileTokenField,
  }),
});

/** Legacy: email + otp + password. Preferred: resetToken + newPassword after verify-otp. */
export const resetPasswordSchema = z.object({
  body: z.union([
    z.object({
      resetToken: z.string().min(32).max(128),
      newPassword: strongPassword,
    }),
    z.object({
      email: emailField,
      otp: otpField,
      newPassword: strongPassword,
    }),
  ]),
});

export const googleAuthSchema = z.object({
  body: z.object({
    credential: z.string().min(10, 'Invalid Google credential'),
  }),
});

/** Unified OTP API (Zoho + Resend fallback); rate limits also enforced in service. */
export const sendOtpSchema = z.object({
  body: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('signup'),
      email: emailField,
      name: nameField,
      password: strongPassword,
      phone: phoneInField,
      turnstileToken: turnstileTokenField,
    }),
    z.object({
      type: z.literal('login'),
      email: emailField,
      turnstileToken: turnstileTokenField,
    }),
    z.object({
      type: z.literal('forgot_password'),
      email: emailField,
      turnstileToken: turnstileTokenField,
    }),
  ]),
});

export const resendOtpSchema = z.object({
  body: z.object({
    type: z.enum(['signup', 'login', 'forgot_password']),
    email: emailField,
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    type: z.enum(['signup', 'login', 'forgot_password']),
    email: emailField,
    otp: otpField,
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: nameField.optional(),
    phone: phoneInField.optional().or(z.literal('')),
  }),
});

export const addAddressSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(2, 'Name is required')
      .max(80)
      .transform((v) => v.normalize('NFC').trim().replace(/\s+/g, ' ')),
    phone: z
      .string()
      .transform((v) => v.replace(/\D/g, '').slice(-10))
      .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Invalid phone number')),
    label: z.string().optional(),
    /** House / flat / building (optional, separate from street). */
    house: z.string().max(120).optional(),
    street: z.string().min(5, 'Street address is required'),
    /** Nearby landmark to help courier (optional). */
    landmark: z.string().max(160).optional(),
    city: z.string().min(2, 'City is required'),
    state: z.string().min(2, 'State is required'),
    pincode: z.string().regex(/^\d{6}$/, 'Invalid pincode'),
    country: z.string().default('India'),
    isDefault: optionalBooleanFromString,
  }),
});

// ─── Products (public query) ──────────────────────────────────────────────────

export const productListQuerySchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      sort: z.string().max(40).optional(),
      search: z.string().max(30).optional(),
      q: z.string().max(30).optional(),
      category: z.string().max(80).optional(),
      fabric: z.string().max(80).optional(),
      minPrice: z.coerce.number().min(0).optional(),
      maxPrice: z.coerce.number().min(0).optional(),
      minRating: z.coerce.number().int().min(1).max(5).optional(),
      isFeatured: z.enum(['true', 'false']).optional(),
      onSale: z.enum(['true', 'false']).optional(),
      hasOffer: z.enum(['true', 'false']).optional(),
      isActive: z.enum(['true', 'false']).optional(),
      isRandom: z.enum(['true', 'false']).optional(),
      excludeIds: z.string().max(4000).optional(),
    })
    .passthrough(),
});

export const productSearchQuerySchema = z.object({
  query: z.object({
    q: z.string().max(30).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sortBy: z.string().max(40).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    category: z.string().max(80).optional(),
    categories: z.union([z.string(), z.array(z.string())]).optional(),
    fabric: z.string().max(80).optional(),
    fabrics: z.union([z.string(), z.array(z.string())]).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    minRating: z.coerce.number().int().min(1).max(5).optional(),
    isFeatured: z.enum(['true', 'false']).optional(),
    onSale: z.enum(['true', 'false']).optional(),
    hasOffer: z.enum(['true', 'false']).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  }),
});

/** Admin catalog list — same query shape as storefront, protected route. */
export const adminProductListQuerySchema = productListQuerySchema;

export const adminProductSearchQuerySchema = productSearchQuerySchema;

export const adminProductIdParamSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid product id'),
  }),
});

export const productAutocompleteQuerySchema = z.object({
  query: z.object({
    q: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(10).optional(),
  }),
});

export const productSuggestionsQuerySchema = z.object({
  query: z.object({
    q: z.string().max(30).optional(),
  }),
});

export const productTrendingQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(20).optional(),
  }),
});

export const productSlugParamSchema = z.object({
  params: z.object({
    slug: z.string().min(1).max(200),
  }),
});

// ─── Products (admin body) ────────────────────────────────────────────────────

const variantSchema = z.object({
  size: z.string().optional(),
  color: z.string().optional(),
  colorCode: z.string().optional(),
  stock: z.coerce.number().min(0, 'Stock cannot be negative'),
  sku: z.string().min(1, 'SKU is required'),
  price: z.coerce.number().positive().optional(),
  costPrice: z.coerce.number().min(0).optional(),
});

const productDetailSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
});

const productCustomFieldSchema = z.object({
  label: z.string().min(1).max(120),
  placeholder: z.string().max(200).optional(),
  fieldType: z.enum(['text', 'textarea', 'select', 'image']),
  options: z.array(z.string().max(120)).optional(),
  isRequired: z.boolean().optional(),
});

const imagesMetaField = z
  .string()
  .optional()
  .describe("JSON array mapping each product image to a color (admin FormData)");

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(3, 'Name must be at least 3 characters').max(200),
    description: z.string().min(10, 'Description must be at least 10 characters'),
    shortDescription: z.string().max(500).optional(),
    // z.coerce.number() handles "1299" → 1299
    price: z.coerce.number().positive('Price must be positive'),
    comparePrice: z.coerce.number().positive().optional(),
    category: z.string().min(1, 'Category is required'),
    subcategory: z.string().optional(),
    fabric: z.string().optional(),
    imagesMeta: imagesMetaField,
    // variants arrives as a JSON string from FormData
    variants: jsonStringToArray(variantSchema).refine(
      (arr) => arr.length > 0,
      'At least one variant is required'
    ),
    // tags arrives as a JSON string or comma-separated string
    tags: z.preprocess((val) => {
      if (!val || val === '') return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val.split(',').map((t: string) => t.trim()).filter(Boolean); }
      }
      return [];
    }, z.array(z.string())).optional(),
    isFeatured: optionalBooleanFromString,
    isActive: optionalBooleanFromString,
    isGiftable: optionalBooleanFromString,
    isCustomizable: optionalBooleanFromString,
    minOrderQty: z.coerce.number().int().min(1).optional(),
    occasions: jsonStringToArray(z.string()).optional(),
    hsnCode: z.string().max(32).optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    customFields: jsonStringToArray(productCustomFieldSchema).optional(),
    productDetails: jsonStringToArray(productDetailSchema).optional(),
  }),
});

export const updateProductSchema = z.object({
  body: z.object({
    /** ISO date from client for optimistic locking (matches document updatedAt). */
    updatedAt: z
      .union([z.string().datetime(), z.string().min(1).max(40)])
      .optional(),
    name: z.string().min(3).max(200).optional(),
    description: z.string().min(10).optional(),
    shortDescription: z.string().max(500).optional(),
    price: z.coerce.number().positive().optional(),
    comparePrice: z.coerce.number().positive().optional(),
    category: z.string().min(1).optional(),
    subcategory: z.string().optional(),
    fabric: z.string().optional(),
    imagesMeta: imagesMetaField,
    variants: jsonStringToArray(variantSchema).optional(),
    tags: z.preprocess((val) => {
      if (!val || val === '') return undefined;
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val.split(',').map((t: string) => t.trim()).filter(Boolean); }
      }
      return undefined;
    }, z.array(z.string()).optional()),
    isFeatured: optionalBooleanFromString,
    isActive: optionalBooleanFromString,
    isGiftable: optionalBooleanFromString,
    isCustomizable: optionalBooleanFromString,
    minOrderQty: z.coerce.number().int().min(1).optional(),
    occasions: jsonStringToArray(z.string()).optional(),
    hsnCode: z.string().max(32).optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    customFields: jsonStringToArray(productCustomFieldSchema).optional(),
    productDetails: jsonStringToArray(productDetailSchema).optional(),
  }),
});

// ─── Cart ─────────────────────────────────────────────────────────────────────

/** @deprecated Import from `cartSchemas` — re-exported for backward compatibility. */
export {
  addToCartSchema,
  updateCartItemSchema,
  applyCouponSchema,
} from './cartSchemas';

// ─── Orders ───────────────────────────────────────────────────────────────────

const marketingAttributionBody = z
  .object({
    utmSource: z.string().trim().max(120).optional(),
    utmMedium: z.string().trim().max(120).optional(),
    utmCampaign: z.string().trim().max(200).optional(),
    utmContent: z.string().trim().max(200).optional(),
    utmTerm: z.string().trim().max(200).optional(),
    fbclid: z.string().trim().max(200).optional(),
    landingPath: z.string().trim().max(200).optional(),
    capturedAt: z.string().trim().max(40).optional(),
  })
  .optional();

const metaBrowserBody = z
  .object({
    fbp: z.string().trim().min(1).max(255).optional(),
    fbc: z.string().trim().min(1).max(255).optional(),
  })
  .optional();

export const createOrderSchema = z.object({
  body: z.object({
    shippingAddress: z.object({
      name: z.string().min(2, 'Name is required').max(80),
      phone: z
        .string()
        .trim()
        // Allow 10-digit Indian mobile, or +91XXXXXXXXXX
        .regex(/^(\+91)?[6-9]\d{9}$/, 'Invalid phone number'),
      label: z.string().optional(),
      house: z.string().max(120).optional(),
      street: z.string().min(5),
      landmark: z.string().max(160).optional(),
      city: z.string().min(2),
      state: z.string().min(2),
      pincode: z.string().regex(/^\d{6}$/),
      country: z.string().default('India'),
    }),
    paymentMethod: z.enum(['razorpay', 'cod']),
    couponCode: z.string().max(40).optional(),
    notes: z.string().max(500).optional(),
    marketingAttribution: marketingAttributionBody,
    metaBrowser: metaBrowserBody,
    buyNowItem: z
      .object({
        productId: z.string().min(1),
        variant: z.object({
          size: z.string().optional(),
          color: z.string().optional(),
          colorCode: z.string().optional(),
          sku: z.string().min(1),
        }),
        quantity: z.coerce.number().int().min(1).max(10),
        customFieldAnswers: z
          .array(
            z.object({
              label: z.string().min(1).max(120),
              value: z.string().min(1).max(500),
            })
          )
          .optional(),
      })
      .optional(),
  }),
});

export const verifyPaymentSchema = z.object({
  body: z
    .object({
      razorpayOrderId: z.string().min(1).max(64),
      razorpayPaymentId: z.string().min(1).max(64),
      razorpaySignature: z.string().min(1).max(256),
      orderId: z
        .string()
        .regex(/^[a-fA-F0-9]{24}$/, 'Invalid order id')
        .optional(),
      checkoutIntentId: z
        .string()
        .regex(/^[a-fA-F0-9]{24}$/, 'Invalid checkout intent id')
        .optional(),
      metaBrowser: metaBrowserBody,
    })
    .refine((b) => Boolean(b.orderId || b.checkoutIntentId), {
      message: 'Either orderId or checkoutIntentId is required',
      path: [],
    }),
});

// ─── Reviews (canonical schemas in validation/reviewSchemas.ts) ───────────────

export { createReviewSchema } from './reviewSchemas';

// ─── Coupons ──────────────────────────────────────────────────────────────────

const mongoObjectId = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const couponCodeField = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .transform((v) => v.toUpperCase());

export const createCouponSchema = z.object({
  body: z
    .object({
      code: couponCodeField,
      description: z.string().max(500).optional(),
      displayTitle: z.string().max(120).optional(),
      imageUrl: z.string().max(2000).optional(),
      imagePublicId: z.string().max(500).optional(),
      showOnStorefront: optionalBooleanFromString,
      discountType: z.enum(['percentage', 'flat', 'fixed']),
      discountValue: z.coerce.number().positive(),
      minOrderAmount: z.coerce.number().min(0).optional(),
      maxDiscountAmount: z.coerce.number().positive().optional(),
      usageLimit: z.coerce.number().int().positive().optional(),
      userUsageLimit: z.coerce.number().int().positive().default(1),
      eligibilityType: z.enum(['all', 'first_order', 'returning']).default('all'),
      minCompletedOrders: z.coerce.number().int().min(0).default(0),
      maxCompletedOrders: z.coerce.number().int().min(0).optional(),
      startDate: z.string().min(1, 'Start date is required'),
      expiryDate: z.string().min(1, 'Expiry date is required'),
      scopeType: z.enum(['all', 'categories', 'subcategories', 'products']).default('all'),
      applicableCategories: jsonStringToArray(z.string()).optional(),
      applicableCategoryIds: jsonStringToArray(mongoObjectId).optional(),
      applicableSubcategoryIds: jsonStringToArray(mongoObjectId).optional(),
      applicableProductIds: jsonStringToArray(mongoObjectId).optional(),
      isActive: optionalBooleanFromString,
      sendAnnouncement: z.coerce.boolean().optional(),
      clearImage: optionalBooleanFromString,
    })
    .superRefine((data, ctx) => {
      const start = new Date(data.startDate);
      const expiry = new Date(data.expiryDate);
      if (Number.isNaN(start.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'Invalid start date', path: ['startDate'] });
      }
      if (Number.isNaN(expiry.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'Invalid expiry date', path: ['expiryDate'] });
      }
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(expiry.getTime()) && expiry <= start) {
        ctx.addIssue({ code: 'custom', message: 'Expiry must be after start date', path: ['expiryDate'] });
      }
      if (data.discountType === 'percentage' && data.discountValue > 100) {
        ctx.addIssue({
          code: 'custom',
          message: 'Percentage discount cannot exceed 100',
          path: ['discountValue'],
        });
      }
      if (
        data.maxCompletedOrders !== undefined &&
        data.maxCompletedOrders < data.minCompletedOrders
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'maxCompletedOrders cannot be less than minCompletedOrders',
          path: ['maxCompletedOrders'],
        });
      }
      if (data.scopeType === 'categories' && !(data.applicableCategoryIds?.length)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Select at least one category',
          path: ['applicableCategoryIds'],
        });
      }
      if (data.scopeType === 'subcategories' && !(data.applicableSubcategoryIds?.length)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Select at least one subcategory',
          path: ['applicableSubcategoryIds'],
        });
      }
      if (data.scopeType === 'products' && !(data.applicableProductIds?.length)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Select at least one product',
          path: ['applicableProductIds'],
        });
      }
    }),
});

export const validateCouponSchema = z.object({
  body: z.object({
    code: couponCodeField,
    orderAmount: z.coerce.number().min(0),
    items: z
      .array(
        z.object({
          productId: mongoObjectId,
          price: z.coerce.number().min(0),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .max(100)
      .optional(),
  }),
});

export const eligibleCouponsQuerySchema = z.object({
  query: z.object({
    orderAmount: z.coerce.number().min(0).optional(),
    /** Optional JSON array of { productId, price, quantity } for buy-now / explicit carts */
    items: z.string().max(20000).optional(),
  }),
});

export const couponIdParamsSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
});

export const updateCouponSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
  body: z
    .object({
      description: z.string().max(500).optional(),
      displayTitle: z.string().max(120).optional(),
      imageUrl: z.string().max(2000).optional(),
      imagePublicId: z.string().max(500).optional(),
      showOnStorefront: optionalBooleanFromString,
      discountType: z.enum(['percentage', 'flat', 'fixed']).optional(),
      discountValue: z.coerce.number().positive().optional(),
      minOrderAmount: z.coerce.number().min(0).optional(),
      maxDiscountAmount: z.coerce.number().positive().optional(),
      usageLimit: z.coerce.number().int().positive().optional(),
      userUsageLimit: z.coerce.number().int().positive().optional(),
      eligibilityType: z.enum(['all', 'first_order', 'returning']).optional(),
      minCompletedOrders: z.coerce.number().int().min(0).optional(),
      maxCompletedOrders: z.coerce.number().int().min(0).optional(),
      startDate: z.string().min(1).optional(),
      expiryDate: z.string().min(1).optional(),
      scopeType: z.enum(['all', 'categories', 'subcategories', 'products']).optional(),
      applicableCategories: jsonStringToArray(z.string()).optional(),
      applicableCategoryIds: jsonStringToArray(mongoObjectId).optional(),
      applicableSubcategoryIds: jsonStringToArray(mongoObjectId).optional(),
      applicableProductIds: jsonStringToArray(mongoObjectId).optional(),
      isActive: optionalBooleanFromString,
      firstOrderOnly: z.coerce.boolean().optional(),
      applicableProducts: jsonStringToArray(mongoObjectId).optional(),
      clearImage: optionalBooleanFromString,
    })
    .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' }),
});

// ─── Admin ────────────────────────────────────────────────────────────────────

const optionalHttpsUrl = z
  .string()
  .max(2000)
  .optional()
  .refine((u) => !u || /^https:\/\//i.test(u.trim()), {
    message: 'Link must be a valid HTTPS URL',
  });

const optionalMarketingCtaLink = z
  .string()
  .max(2000)
  .optional()
  .refine(
    (u) => {
      if (!u?.trim()) return true;
      const v = u.trim();
      return /^https:\/\/.+/i.test(v) || (v.startsWith('/') && !v.startsWith('//'));
    },
    { message: 'Link must be HTTPS or a site path starting with /' },
  );

export const marketingAudiencePreviewQuerySchema = z.object({
  query: z.object({
    audience: z.enum(['all', 'users', 'admins', 'selected']).optional(),
    channels: z.string().max(200).optional(),
    includeOfflineLeads: z.enum(['true', 'false']).optional(),
  }),
});

export const sendMarketingEmailSchema = z.object({
  body: z.object({
    subject: z.string().min(1).max(200),
    messageHtml: z.string().min(1).max(100_000),
    audience: z.enum(['all', 'users', 'admins', 'selected']).optional(),
    userIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).max(5000).optional(),
    ctaText: z.string().max(120).optional(),
    ctaLink: optionalMarketingCtaLink,
    channels: z
      .array(z.enum(['email', 'in_app', 'push']))
      .min(1)
      .max(3)
      .optional(),
    includeOfflineLeads: z.coerce.boolean().optional(),
  }),
});

export const updateOrderStatusSchema = z.object({
  body: z.object({
    status: z.enum(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
    note: z.string().optional(),
    shippingCarrier: z.string().trim().max(60).optional(),
    trackingNumber: z.string().trim().max(80).optional(),
    trackingUrl: z.string().trim().url().optional(),
  }).superRefine((val, ctx) => {
    if (val.status === 'shipped') {
      if (!val.shippingCarrier || val.shippingCarrier.trim().length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Courier is required for shipped orders', path: ['shippingCarrier'] });
      }
      if (!val.trackingNumber || val.trackingNumber.trim().length < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tracking/AWB number is required for shipped orders', path: ['trackingNumber'] });
      }
    }
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const processRefundSchema = z.object({
  body: z.object({
    refundMethod: z.enum(['razorpay_auto', 'cash', 'bank_transfer', 'upi_manual']).optional(),
    amount: z.coerce.number().positive(),
    notes: z.string().max(1000).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const delhiveryEstimateSchema = z.object({
  body: z.object({
    md: z.enum(['E', 'S']),
    lengthCm: z.coerce.number().positive(),
    breadthCm: z.coerce.number().positive(),
    heightCm: z.coerce.number().positive(),
    weightGm: z.coerce.number().positive(),
    boxCount: z.coerce.number().int().min(1).max(5).optional(),
    ipkg_type: z.enum(['box', 'flyer']).optional(),
  }),
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid order id'),
  }),
});

export const delhiveryCreateShipmentSchema = z.object({
  body: z.object({
    shippingMode: z.enum(['Surface', 'Express']),
    lengthCm: z.coerce.number().positive(),
    breadthCm: z.coerce.number().positive(),
    heightCm: z.coerce.number().positive(),
    weightGm: z.coerce.number().positive(),
    boxCount: z.coerce.number().int().min(1).max(5).optional(),
    ipkg_type: z.enum(['box', 'flyer']).optional(),
  }),
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid order id'),
  }),
});

export const delhiveryOrderIdParamsSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid order id'),
  }),
});

/** GET /admin/orders/:id/delhivery/packing-slip?pdf_size= */
export const delhiveryPackingSlipQuerySchema = z.object({
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid order id'),
  }),
  query: z.object({
    pdf_size: z.enum(['4R', 'A4', '4r', 'a4']).optional(),
  }),
});

/** GET /admin/delhivery/serviceability?pin= */
export const delhiveryServiceabilityQuerySchema = z.object({
  query: z.object({
    pin: z.preprocess(
      (v) => (Array.isArray(v) ? v[0] : v),
      z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
    ),
  }),
});

const offlineShippingAddressSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  phone: z.string().min(8).max(20).optional(),
  house: z.string().max(120).optional(),
  street: z.string().min(1).max(200),
  landmark: z.string().max(200).optional(),
  city: z.string().min(1).max(80),
  state: z.string().min(1).max(80),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
  country: z.string().max(60).optional(),
});

const offlineCatalogLineSchema = z.object({
  type: z.literal('catalog'),
  productId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid product id'),
  variantSku: z.string().min(1).max(80),
  quantity: z.coerce.number().int().min(1).max(50),
  unitPrice: z.coerce.number().min(0).optional(),
});

const offlineManualLineSchema = z
  .object({
    type: z.literal('manual'),
    /** When set, line uses category display name + image (shop / non-gift categories only). */
    categoryId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    /** Free-text line when categoryId is omitted. */
    title: z.string().max(200).optional(),
    quantity: z.coerce.number().int().min(1).max(50),
    unitPrice: z.coerce.number().min(0),
  })
  .superRefine((d, ctx) => {
    const hasCat = Boolean(d.categoryId?.trim());
    const hasTitle = Boolean(d.title?.trim());
    if (!hasCat && !hasTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select a shop category or enter a custom line description.',
        path: ['title'],
      });
    }
  });

export const createOfflineOrderSchema = z.object({
  body: z
    .object({
      customerName: z.string().min(2).max(50),
      email: z.string().email().or(z.literal('')).optional(),
      phone: z.string().min(8).max(20).or(z.literal('')).optional(),
      orderSource: z.enum(['stall', 'personal_contact']),
      fulfillment: z.enum(['delhivery', 'offline_handover']),
      paymentMethod: z.enum(['offline_upi', 'offline_cash']),
      shippingAddress: offlineShippingAddressSchema.optional(),
      // `discriminatedUnion` cannot mix a plain object with `.superRefine()` (ZodEffects) — use `union`.
      lineItems: z
        .array(z.union([offlineCatalogLineSchema, offlineManualLineSchema]))
        .min(1)
        .max(30),
      notes: z.string().max(2000).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.fulfillment === 'delhivery' && !data.shippingAddress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Shipping address is required when fulfillment is Delhivery.',
          path: ['shippingAddress'],
        });
      }
    }),
});

export const updateUserRoleSchema = z.object({
  body: z.object({
    role: z.enum(['user', 'admin']),
  }),
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid user id'),
  }),
});

export const updateUserNoteSchema = z.object({
  body: z.object({
    note: z.string().max(1000).optional().default(''),
  }),
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid user id'),
  }),
});

// ─── Category ─────────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Category name required').max(50),
    slug: z.string().optional(),
    description: z.string().optional(),
    subcategories: jsonStringToArray(z.string()).optional(),
    isActive: optionalBooleanFromString,
  }),
});

// ─── Gifting (canonical schemas in giftingSchemas.ts) ─────────────────────────

export {
  submitGiftingRequestSchema,
  giftingAdminUpdateSchema,
  giftingRespondSchema,
} from './giftingSchemas';

// ─── Inventory (canonical schemas in inventorySchemas.ts) ─────────────────────

export {
  stockAdjustmentSchema,
  createPurchaseInvoiceSchema,
  updatePurchaseInvoiceSchema,
  inventoryOverviewQuerySchema,
} from './inventorySchemas';

export {
  operatingExpenseListQuerySchema,
  operatingExpenseSummaryQuerySchema,
  createOperatingExpenseSchema,
  updateOperatingExpenseSchema,
  operatingExpenseIdParamsSchema,
} from './operatingExpenseSchemas';
