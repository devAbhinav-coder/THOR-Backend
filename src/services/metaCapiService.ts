import axios from "axios";
import crypto from "crypto";
import { IOrder } from "../types";

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
const API_VERSION = "v19.0"; // Meta Graph API Version

const hash = (value: string) =>
  crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

/**
 * Normalizes user data for Meta CAPI requirements (lowercased, SHA-256 hashed).
 */
export const sendPurchaseEvent = async (
  order: IOrder & { _id: any; user?: any },
  reqIp?: string,
  reqUserAgent?: string,
  fbp?: string,
  fbc?: string
) => {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn("Meta CAPI is not configured. Missing PIXEL_ID or META_CAPI_TOKEN.");
    return;
  }

  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

    // Map order items to Meta CAPI contents schema
    const contents = order.items.map((item) => {
      const productId = typeof item.product === "object" && item.product !== null && "_id" in item.product
        ? (item.product as any)._id.toString()
        : (item.product as any).toString();

      return {
        id: productId,
        quantity: item.quantity,
        item_price: item.price,
      };
    });

    // We generate an event_id using order ID for deduplication 
    // This MUST match the client-side event_id if we want true deduplication!
    // But since Next.js frontend sends standard fbq, CAPI deduplication relies on matching IDs.
    const eventId = `order_${order._id}`;

    // Try to safely extract email and phone
    const email = ((order as any).email || order.user?.email || "").toString().trim();
    const phone = (order.shippingAddress?.phone || "").toString().trim();

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          event_id: eventId,
          event_source_url: `${process.env.FRONTEND_URL || 'https://thehouseofrani.com'}/dashboard/orders/${order._id}`,
          user_data: {
            client_ip_address: reqIp || "127.0.0.1",
            client_user_agent: reqUserAgent || "Unknown User Agent",
            em: email ? hash(email) : undefined,
            ph: phone ? hash(phone) : undefined,
            fbp: fbp,
            fbc: fbc,
          },
          custom_data: {
            currency: "INR",
            value: order.total,
            contents: contents,
            content_ids: contents.map(c => c.id),
            content_type: "product_group",
            order_id: order._id.toString(),
          },
        },
      ],
      access_token: ACCESS_TOKEN,
    };

    const response = await axios.post(url, payload, { timeout: 5000 });
    
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Meta CAPI] Purchase event sent for Order ${order._id}`, response.data);
    }
  } catch (error: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[Meta CAPI Error] Failed to send event:", error?.response?.data || error.message);
    }
  }
};
