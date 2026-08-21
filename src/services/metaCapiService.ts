import axios from "axios";
import { IOrder } from "../types";
import { getMetaCatalogItemId } from "../utils/metaCatalogId";
import {
  buildMetaCapiUserData,
  buildMetaCapiUserDataFromOrder,
  type MetaUserDataInput,
} from "../utils/metaUserData";

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
const API_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";

export type MetaEventName =
  | "PageView"
  | "ViewContent"
  | "Search"
  | "AddToCart"
  | "InitiateCheckout"
  | "AddToWishlist"
  | "AddPaymentInfo"
  | "CompleteRegistration"
  | "Contact";

export type MetaCustomData = {
  currency?: string;
  value?: number;
  content_name?: string;
  content_ids?: string[];
  content_type?: "product" | "product_group";
  search_string?: string;
  num_items?: number;
  status?: string;
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
  user?: MetaUserDataInput;
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
    const user_data = buildMetaCapiUserData(context, context.user);

    await postMetaEvent({
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_id: eventId,
      event_source_url: eventSourceUrl,
      user_data,
      ...(customData && Object.keys(customData).length > 0 ?
        { custom_data: customData }
      : {}),
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
  fbc?: string,
) => {
  try {
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

    const eventId = `order_${order._id}`;
    const userId =
      typeof order.user === "object" && order.user?._id ?
        order.user._id.toString()
      : typeof order.user === "string" ? order.user
      : undefined;

    const user_data = buildMetaCapiUserDataFromOrder(
      {
        ip: reqIp,
        userAgent: reqUserAgent,
        fbp,
        fbc,
      },
      order,
      userId,
    );

    await postMetaEvent({
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_id: eventId,
      event_source_url: `${process.env.FRONTEND_URL || "https://thehouseofrani.com"}/checkout?order=${order._id}`,
      user_data,
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
      console.error(
        "[Meta CAPI Error] Failed to send event:",
        error?.response?.data || error.message,
      );
    }
  }
};
