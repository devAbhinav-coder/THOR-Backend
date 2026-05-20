/** Mongo query timeout for payment-critical reads/writes. */
export const PAYMENT_QUERY_MAX_MS = 5000;

/** Lean fields returned after verify / prepare (checkout + analytics). */
export const ORDER_PAYMENT_RESPONSE_SELECT = [
  '_id',
  'orderNumber',
  'user',
  'items',
  'shippingAddress',
  'status',
  'paymentStatus',
  'paymentMethod',
  'subtotal',
  'discount',
  'shippingCharge',
  'codFee',
  'tax',
  'total',
  'coupon',
  'razorpayOrderId',
  'razorpayPaymentId',
  'productType',
  'invoice',
  'createdAt',
  'updatedAt',
].join(' ');

/** Intent fields needed during verify (avoids loading full snapshot blobs when possible). */
export const CHECKOUT_INTENT_VERIFY_SELECT = [
  '_id',
  'user',
  'razorpayOrderId',
  'expiresAt',
  'consumedAt',
  'createdOrderId',
  'snapshot',
  'verifyAttempts',
].join(' ');
