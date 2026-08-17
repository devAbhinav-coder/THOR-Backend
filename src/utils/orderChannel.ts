/** Sales channel for paid orders (analytics / revenue dashboards). */
export type OrderSalesChannel = "online" | "offline" | "b2b";

export type OrderSalesChannelFilter = OrderSalesChannel | "all";

export function orderSalesChannel(
  offlineMeta?: { source?: string | null } | null,
): OrderSalesChannel {
  if (!offlineMeta) return "online";
  if (offlineMeta.source === "b2b") return "b2b";
  return "offline";
}

/** MongoDB $switch expression: classify order channel from offlineMeta. */
export const ORDER_CHANNEL_SWITCH = {
  $switch: {
    branches: [
      { case: { $eq: ["$offlineMeta.source", "b2b"] }, then: "b2b" },
      {
        case: { $ifNull: ["$offlineMeta", false] },
        then: "offline",
      },
    ],
    default: "online",
  },
} as const;

/** Optional revenue/analytics filter by sales channel. */
export function orderChannelMatch(
  channel?: OrderSalesChannelFilter,
): Record<string, unknown> {
  if (!channel || channel === "all") return {};
  return {
    $expr: { $eq: [ORDER_CHANNEL_SWITCH, channel] },
  };
}

const CHANNEL_LABELS: Record<OrderSalesChannel, string> = {
  online: "Online",
  offline: "Offline",
  b2b: "B2B",
};

export function orderChannelFilterLabel(
  channel?: OrderSalesChannelFilter,
): string | null {
  if (!channel || channel === "all") return null;
  return CHANNEL_LABELS[channel];
}
