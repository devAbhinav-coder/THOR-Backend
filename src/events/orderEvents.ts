import mongoose from 'mongoose';

export enum OrderEventType {
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_PAID = 'ORDER_PAID',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  RETURN_REQUESTED = 'RETURN_REQUESTED',
}

export interface OrderEventPayload {
  eventType: OrderEventType;
  orderId: string;
  orderNumber: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  total: number;
  paymentMethod?: string;
  cancelReason?: string;
  returnReason?: string;
  refundMethod?: string;
  ip?: string;
  userAgent?: string;
  fbpCookie?: string;
  fbcCookie?: string;
  razorpayPaymentId?: string;
}
