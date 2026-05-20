/**
 * In-app / push notification copy for order lifecycle events.
 * Keep tone consistent: warm, professional, brand-forward (The House of Rani).
 */

export type OrderNotificationTone =
  | 'order'
  | 'promotion'
  | 'alert'
  | 'info'
  | 'success'
  | 'error'
  | 'system';

export type OrderNotificationCopy = {
  title: string;
  message: string;
  type: OrderNotificationTone;
};

export type OrderTrackingSnippet = {
  carrier?: string | null;
  awb?: string | null;
  trackingUrl?: string | null;
};

const BRAND = 'The House of Rani';

function trackingLine(opts?: OrderTrackingSnippet): string {
  if (!opts) return '';
  const parts: string[] = [];
  if (opts.carrier?.trim()) parts.push(`via ${opts.carrier.trim()}`);
  if (opts.awb?.trim()) parts.push(`AWB ${opts.awb.trim()}`);
  if (!parts.length) return '';
  return ` ${parts.join(' · ')}.`;
}

/** Online checkout — order placed (COD or pre-payment). */
export function getOnlineOrderPlacedCopy(orderNumber: string): OrderNotificationCopy {
  return {
    title: `Order confirmed — ${orderNumber}`,
    message: `Thank you for choosing ${BRAND}. We're preparing your order with care — follow every update from your account.`,
    type: 'order',
  };
}

/** Online checkout — payment captured (Razorpay / paid). */
export function getOnlineOrderPaidCopy(orderNumber: string): OrderNotificationCopy {
  return {
    title: `Payment received — ${orderNumber}`,
    message: `Your payment is confirmed and your order is in our fulfillment queue. We'll share shipping details as soon as your parcel is dispatched.`,
    type: 'success',
  };
}

/** Customer-initiated cancellation. */
export function getOnlineOrderCancelledCopy(
  orderNumber: string,
  razorpayPaid: boolean
): OrderNotificationCopy {
  const refundNote = razorpayPaid
    ? ' Any paid amount will be refunded to your original payment method within 5–7 business days.'
    : '';
  return {
    title: `Order cancelled — ${orderNumber}`,
    message: `Your cancellation is confirmed.${refundNote} We're here if you need anything else.`,
    type: 'info',
  };
}

/** Admin offline sale — customer took items at the stall / in person. */
export function getOfflineHandoverCopy(orderNumber: string): OrderNotificationCopy {
  return {
    title: `Thank you for your purchase — ${orderNumber}`,
    message: `Your in-person order with ${BRAND} is complete. Your invoice and order history are saved in your account whenever you need them.`,
    type: 'success',
  };
}

/** Admin offline sale — order will ship (Delhivery / courier). */
export function getOfflineShipLaterCopy(orderNumber: string): OrderNotificationCopy {
  return {
    title: `Order registered — ${orderNumber}`,
    message: `We've added your purchase to your ${BRAND} account. Once your parcel is dispatched, you'll receive shipping and tracking details here.`,
    type: 'order',
  };
}

/** Admin or system status change on an existing order. */
export function getOrderStatusUpdateCopy(
  orderNumber: string,
  status: string,
  tracking?: OrderTrackingSnippet
): OrderNotificationCopy {
  switch (status) {
    case 'confirmed':
      return {
        title: `Order confirmed — ${orderNumber}`,
        message: `Your order is confirmed and will move into processing shortly. Thank you for shopping with ${BRAND}.`,
        type: 'order',
      };
    case 'processing':
      return {
        title: `We're preparing your order — ${orderNumber}`,
        message: `Our team is carefully preparing your pieces. You'll hear from us again when your order is ready to ship.`,
        type: 'order',
      };
    case 'shipped':
      return getOrderShippedCopy(orderNumber, tracking);
    case 'delivered':
      return getOrderDeliveredCopy(orderNumber);
    case 'cancelled':
      return getOrderCancelledByAdminCopy(orderNumber);
    case 'return_requested':
      return {
        title: `Return request received — ${orderNumber}`,
        message: `We've received your return request and our team is reviewing it. We'll update you as soon as there's a decision.`,
        type: 'info',
      };
    case 'returned':
      return {
        title: `Return completed — ${orderNumber}`,
        message: `Your return for this order has been processed. Check your account for refund or next-step details.`,
        type: 'info',
      };
    case 'refunded':
      return {
        title: `Refund update — ${orderNumber}`,
        message: `A refund has been recorded for this order. See your order page for amount and timeline details.`,
        type: 'success',
      };
    default:
      return {
        title: `Order update — ${orderNumber}`,
        message: `There's a new update on your order. Sign in to your account to view the latest status.`,
        type: 'order',
      };
  }
}

export function getOrderShippedCopy(
  orderNumber: string,
  tracking?: OrderTrackingSnippet
): OrderNotificationCopy {
  const tail = trackingLine(tracking);
  return {
    title: `Your order has shipped — ${orderNumber}`,
    message: tail
      ? `Your parcel is on its way${tail} Track it anytime from your orders page.`
      : `Your parcel has left our studio and is on its way to you. Track progress from your orders page.`,
    type: 'order',
  };
}

export function getOrderDeliveredCopy(orderNumber: string): OrderNotificationCopy {
  return {
    title: `Delivered — ${orderNumber}`,
    message: `Your order has arrived. We hope you love every piece — thank you for being part of ${BRAND}.`,
    type: 'success',
  };
}

export function getOrderCancelledByAdminCopy(orderNumber: string): OrderNotificationCopy {
  return {
    title: `Order cancelled — ${orderNumber}`,
    message: `This order has been cancelled. If this wasn't expected, please reach out to our support team — we're happy to help.`,
    type: 'error',
  };
}

export function getRefundProcessedCopy(
  orderNumber: string,
  amount: number,
  detailMessage: string
): OrderNotificationCopy {
  return {
    title: `Refund processed — ${orderNumber}`,
    message: `₹${amount.toFixed(2)} — ${detailMessage}`,
    type: 'success',
  };
}

export function getReturnResolvedCopy(
  orderNumber: string,
  approved: boolean,
  adminNote?: string
): OrderNotificationCopy {
  if (approved) {
    return {
      title: `Return approved — ${orderNumber}`,
      message: `Your return has been approved. We'll process your refund shortly and keep you updated in your account.`,
      type: 'success',
    };
  }
  const note = adminNote?.trim() ? ` Note from our team: ${adminNote.trim()}` : '';
  return {
    title: `Return update — ${orderNumber}`,
    message: `We weren't able to approve this return request.${note} Contact support if you'd like to discuss further.`,
    type: 'error',
  };
}
