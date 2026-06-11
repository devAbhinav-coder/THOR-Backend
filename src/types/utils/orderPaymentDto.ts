/**
 * Lightweight order payload for payment verify / prepare responses.
 * Strips admin-only blobs (delhivery, returnRequest, statusHistory, offlineMeta, refundData).
 */
export function toOrderPaymentDto(order: Record<string, unknown>): Record<string, unknown> {
  const id = order._id;
  return {
    _id: id != null ? String(id) : order._id,
    orderNumber: order.orderNumber,
    user: order.user != null ? String(order.user) : order.user,
    items: order.items,
    shippingAddress: order.shippingAddress,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    subtotal: order.subtotal,
    discount: order.discount ?? 0,
    shippingCharge: order.shippingCharge ?? 0,
    codFee: order.codFee ?? 0,
    tax: order.tax ?? 0,
    total: order.total,
    coupon: order.coupon,
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: order.razorpayPaymentId,
    productType: order.productType,
    invoice: order.invoice,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
