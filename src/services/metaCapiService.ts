import axios from "axios";
import crypto from "crypto";
import { IOrder } from "../types";
import { getMetaCatalogItemId } from "../utils/metaCatalogId";

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
const API_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";

const hash = (value: string) =>
  crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

export type MetaEventName =
  | "PageView"
  | "ViewContent"
  | "Search"
  | "AddToCart"
  | "InitiateCheckout"
  | "AddToWishlist";

export type MetaCustomData = {
  currency?: string;
  value?: number;
  content_name?: string;
  content_ids?: string[];
  content_type?: "product" | "product_group";
  search_string?: string;
  num_items?: number;
  contents?: Array<{
    id: string;
    quantity: number;
    item_price?: number;
  }>;
};

type MetaRequestContext = {
  ip?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
};

function configured(): boolean {
  if (PIXEL_ID && ACCESS_TOKEN) return true;
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "Meta CAPI is not configured. Missing META_PIXEL_ID or META_CAPI_TOKEN.",
    );
  }
  return false;
}

/** Safe flags for admin analytics — never exposes token or pixel secrets. */
export function getMetaTrackingStatus(): {
  pixelConfigured: boolean;
  capiConfigured: boolean;
} {
  const pixelConfigured = Boolean(PIXEL_ID?.trim());
  return {
    pixelConfigured,
    capiConfigured: pixelConfigured && Boolean(ACCESS_TOKEN?.trim()),
  };
}

async function postMetaEvent(event: Record<string, unknown>): Promise<void> {
  if (!configured()) return;

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;
  await axios.post(
    url,
    { data: [event] },
    {
      params: { access_token: ACCESS_TOKEN },
      timeout: 5000,
    },
  );
}

/**
 * Sends a browser-matched CAPI event. The eventId must be the same value passed
 * to fbq so Meta can deduplicate the browser and server copies.
 */
export async function sendBrowserMetaEvent(
  eventName: MetaEventName,
  eventId: string,
  eventSourceUrl: string,
  customData: MetaCustomData,
  context: MetaRequestContext,
): Promise<void> {
  try {
    await postMetaEvent({
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_id: eventId,
      event_source_url: eventSourceUrl,
      user_data: {
        client_ip_address: context.ip,
        client_user_agent: context.userAgent,
        fbp: context.fbp,
        fbc: context.fbc,
      },
      custom_data: customData,
    });
  } catch (error: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[Meta CAPI Error] ${eventName} failed:`,
        error?.response?.data || error.message,
      );
    }
  }
}

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
  try {
    // Map order items to Meta CAPI contents schema
    const contents = order.items.map((item) => {
      const productId =
        typeof item.product === "object" &&
        item.product !== null &&
        "_id" in item.product
          ? (item.product as { _id: { toString(): string } })._id.toString()
          : String(item.product);

      return {
        id: getMetaCatalogItemId(productId, item.variant),
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

    await postMetaEvent({
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_id: eventId,
      event_source_url: `${process.env.FRONTEND_URL || "https://thehouseofrani.com"}/checkout?order=${order._id}`,
      user_data: {
        client_ip_address: reqIp,
        client_user_agent: reqUserAgent,
        em: email ? hash(email) : undefined,
        ph: phone ? hash(phone) : undefined,
        fbp,
        fbc,
      },
      custom_data: {
        currency: "INR",
        value: order.total,
        contents,
        content_ids: contents.map((content) => content.id),
        content_type: "product",
        order_id: order._id.toString(),
      },
    });

    if (process.env.NODE_ENV !== "production") {
      console.log(`[Meta CAPI] Purchase event sent for Order ${order._id}`);
    }
  } catch (error: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[Meta CAPI Error] Failed to send event:", error?.response?.data || error.message);
    }
  }
};
