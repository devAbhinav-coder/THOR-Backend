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

const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase and number');

export const signupStartSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(50),
    email: z.string().email('Invalid email address'),
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
    password: strongPassword,
  }),
});

export const signupVerifySchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    newPassword: strongPassword,
  }),
});

export const googleAuthSchema = z.object({
  body: z.object({
    credential: z.string().min(10, 'Invalid Google credential'),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(50).optional(),
    phone: z
      .string()
      .regex(/^[6-9]\d{9}$/)
      .optional()
      .or(z.literal('')),
  }),
});

export const addAddressSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name is required').max(80),
    phone: z
      .string()
      .trim()
      .regex(/^(\+91)?[6-9]\d{9}$/, 'Invalid phone number'),
    label: z.string().optional(),
    street: z.string().min(5, 'Street address is required'),
    city: z.string().min(2, 'City is required'),
    state: z.string().min(2, 'State is required'),
    pincode: z.string().regex(/^\d{6}$/, 'Invalid pincode'),
    country: z.string().default('India'),
    isDefault: optionalBooleanFromString,
  }),
});

// ─── Products ─────────────────────────────────────────────────────────────────

const variantSchema = z.object({
  size: z.string().optional(),
  color: z.string().optional(),
  colorCode: z.string().optional(),
  stock: z.coerce.number().min(0, 'Stock cannot be negative'),
  sku: z.string().min(1, 'SKU is required'),
  price: z.coerce.number().positive().optional(),
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
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    customFields: jsonStringToArray(productCustomFieldSchema).optional(),
    productDetails: jsonStringToArray(productDetailSchema).optional(),
  }),
});

export const updateProductSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(200).optional(),
    description: z.string().min(10).optional(),
    shortDescription: z.string().max(500).optional(),
    price: z.coerce.number().positive().optional(),
    comparePrice: z.coerce.number().positive().optional(),
    category: z.string().min(1).optional(),
    subcategory: z.string().optional(),
    fabric: z.string().optional(),
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
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    customFields: jsonStringToArray(productCustomFieldSchema).optional(),
    productDetails: jsonStringToArray(productDetailSchema).optional(),
  }),
});

// ─── Cart ─────────────────────────────────────────────────────────────────────

export const addToCartSchema = z.object({
  body: z.object({
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
  }),
});

export const updateCartItemSchema = z.object({
  body: z.object({
    quantity: z.coerce.number().int().min(1).max(10),
  }),
  params: z.object({
    sku: z.string().min(1),
  }),
});

// ─── Orders ───────────────────────────────────────────────────────────────────

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
      street: z.string().min(5),
      city: z.string().min(2),
      state: z.string().min(2),
      pincode: z.string().regex(/^\d{6}$/),
      country: z.string().default('India'),
    }),
    paymentMethod: z.enum(['razorpay', 'cod']),
    couponCode: z.string().max(40).optional(),
    notes: z.string().max(500).optional(),
  }),
});

export const verifyPaymentSchema = z.object({
  body: z.object({
    razorpayOrderId: z.string().min(1).max(64),
    razorpayPaymentId: z.string().min(1).max(64),
    razorpaySignature: z.string().min(1).max(256),
    orderId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid order id'),
  }),
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

export const createReviewSchema = z.object({
  body: z.object({
    rating: z.coerce.number().int().min(1).max(5),
    title: z.string().max(100).optional(),
    comment: z.string().min(10).max(1000),
    orderId: z.string().min(1),
  }),
  params: z.object({
    productId: z.string().min(1),
  }),
});

// ─── Coupons ──────────────────────────────────────────────────────────────────

export const createCouponSchema = z.object({
  body: z.object({
    code: z.string().min(3).max(20).toUpperCase(),
    description: z.string().optional(),
    discountType: z.enum(['percentage', 'flat']),
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
    applicableCategories: jsonStringToArray(z.string()).optional(),
    isActive: optionalBooleanFromString,
  }),
});

// ─── Admin ────────────────────────────────────────────────────────────────────

const optionalHttpsUrl = z
  .string()
  .max(2000)
  .optional()
  .refine((u) => !u || /^https:\/\//i.test(u.trim()), {
    message: 'Link must be a valid HTTPS URL',
  });

export const sendMarketingEmailSchema = z.object({
  body: z.object({
    subject: z.string().min(1).max(200),
    messageHtml: z.string().min(1).max(100_000),
    audience: z.enum(['all', 'users', 'admins', 'selected']).optional(),
    userIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).max(5000).optional(),
    ctaText: z.string().max(120).optional(),
    ctaLink: optionalHttpsUrl,
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

export const updateUserRoleSchema = z.object({
  body: z.object({
    role: z.enum(['user', 'admin']),
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

// ─── Gifting ──────────────────────────────────────────────────────────────────

const giftingItemSchema = z.object({
  product: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid product id'),
  name: z.string().min(1).max(200),
  quantity: z.coerce.number().int().min(1).max(10000),
  customFieldAnswers: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        label: z.string().min(1).max(120),
        value: z.string().min(1).max(500),
      })
    )
    .optional(),
});

export const submitGiftingRequestSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    phone: z.string().trim().max(20).optional(),
    occasion: z.string().min(2).max(120),
    items: jsonStringToArray(giftingItemSchema).refine((arr) => arr.length > 0, 'At least one item is required'),
    recipientMessage: z.string().max(500).optional(),
    customizationNote: z.string().max(1000).optional(),
    packagingPreference: z.enum(['standard', 'premium', 'custom']).optional(),
    customPackagingNote: z.string().max(500).optional(),
    proposedPrice: z.coerce.number().positive().optional(),
  }),
});

export const giftingAdminUpdateSchema = z.object({
  body: z.object({
    status: z.enum(['new', 'price_quoted', 'approved_by_user', 'rejected_by_user', 'cancelled']).optional(),
    adminNote: z.string().max(1000).optional(),
    quotedPrice: z.coerce.number().positive().optional(),
    deliveryTime: z.string().max(120).optional(),
  }),
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  }),
});

export const giftingRespondSchema = z.object({
  body: z.object({
    action: z.enum(['accept', 'reject']),
    shippingAddress: z
      .object({
        name: z.string().min(2).max(80),
        phone: z.string().trim().max(20).optional(),
        label: z.string().max(40).optional(),
        street: z.string().min(5).max(250),
        city: z.string().min(2).max(80),
        state: z.string().min(2).max(80),
        pincode: z.string().regex(/^\d{6}$/),
        country: z.string().max(60).optional(),
      })
      .optional(),
  }),
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  }),
});
