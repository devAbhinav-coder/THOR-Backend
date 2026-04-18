import Order from "../models/Order";
import { trackPackages } from "./delhiveryService";
import { delhiveryIsConfigured } from "../config/delhivery";
import logger from "../utils/logger";
import { enqueueEmail } from "../queues/emailQueue";
import { emailTemplates } from "./emailService";
import { notifyUser } from "./notificationService";

function carrierIsDelhivery(carrier?: string): boolean {
  return (carrier || "").toLowerCase().includes("delhivery");
}

export type DelhiveryScanLine = {
  status?: string;
  time?: string;
  location?: string;
  detail?: string;
};

/** Top-level hints when Delhivery returns an envelope without ShipmentData yet */
function parseTrackApiEnvelope(json: unknown): { apiError?: string; emptyShipmentData?: boolean } {
  if (!json || typeof json !== "object") return {};
  const o = json as Record<string, unknown>;
  if (o.success === false) {
    const msg =
      typeof o.error === "string" ?
        o.error
      : typeof o.rmk === "string" ?
        o.rmk
      : "Delhivery returned success=false";
    return { apiError: msg };
  }
  if (Array.isArray(o.ShipmentData) && o.ShipmentData.length === 0) {
    return { emptyShipmentData: true };
  }
  return {};
}

/**
 * Best-effort parse of /api/v1/packages/json — Delhivery nests status under
 * ShipmentData[].Shipment.Status.Status and scans under Shipment.Scans; we must recurse.
 */
export function parseDelhiveryTrackSummary(json: unknown): {
  statusText?: string;
  delivered: boolean;
  rto: boolean;
  scans: DelhiveryScanLine[];
  apiError?: string;
  emptyShipmentData?: boolean;
} {
  const scans: DelhiveryScanLine[] = [];
  let statusFromShipment: string | undefined;
  let delivered = false;
  let rto = false;

  const bumpFlags = (s: string) => {
    const low = s.toLowerCase();
    if (low.includes("delivered")) delivered = true;
    if (low.includes("rto") || low.includes("return to origin")) rto = true;
  };

  const pushScan = (r: Record<string, unknown>) => {
    const status =
      (typeof r.Status === "string" ? r.Status : undefined) ||
      (typeof r.ScanDetail === "string" ? r.ScanDetail : undefined) ||
      (typeof r.scan_status === "string" ? r.scan_status : undefined) ||
      (typeof r.ScanType === "string" ? r.ScanType : undefined) ||
      (typeof r.Instructions === "string" ? r.Instructions : undefined);
    const time =
      (typeof r.ScanDateTime === "string" ? r.ScanDateTime : undefined) ||
      (typeof r.StatusDateTime === "string" ? r.StatusDateTime : undefined) ||
      (typeof r.updated_at === "string" ? r.updated_at : undefined) ||
      (typeof r.ScanTime === "string" ? r.ScanTime : undefined);
    const location =
      (typeof r.ScannedLocation === "string" ? r.ScannedLocation : undefined) ||
      (typeof r.StatusLocation === "string" ? r.StatusLocation : undefined) ||
      (typeof r.ScanLocation === "string" ? r.ScanLocation : undefined) ||
      (typeof r.location === "string" ? r.location : undefined);
    const detail = typeof r.ScanDetail === "string" ? r.ScanDetail : undefined;
    if (status || time || location || detail) {
      scans.push({ status, time, location, detail });
    }
  };

  const visit = (node: unknown, depth: number): void => {
    if (depth > 45 || node == null) return;
    if (typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    const o = node as Record<string, unknown>;

    // String status on node
    if (typeof o.Status === "string" && !statusFromShipment) {
      statusFromShipment = o.Status;
      bumpFlags(o.Status);
    }

    // Shipment.Status.Status (canonical Delhivery pull API)
    if (o.Shipment && typeof o.Shipment === "object") {
      const ship = o.Shipment as Record<string, unknown>;
      if (ship.Status && typeof ship.Status === "object") {
        const st = ship.Status as Record<string, unknown>;
        if (typeof st.Status === "string") {
          statusFromShipment = st.Status;
          bumpFlags(st.Status);
        }
      }
    }

    // Nested Status object { Status: "Manifested", StatusDateTime, ... }
    if (o.Status && typeof o.Status === "object" && !Array.isArray(o.Status)) {
      const st = o.Status as Record<string, unknown>;
      if (typeof st.Status === "string") {
        if (!statusFromShipment) statusFromShipment = st.Status;
        bumpFlags(st.Status);
      }
    }

    for (const key of ["Scans", "scans", "ScanHistory"] as const) {
      const arr = o[key];
      if (Array.isArray(arr)) {
        for (const sc of arr) {
          if (sc && typeof sc === "object") pushScan(sc as Record<string, unknown>);
        }
      }
    }

    for (const v of Object.values(o)) {
      if (v && typeof v === "object") visit(v, depth + 1);
    }
  };

  visit(json, 0);

  const env = parseTrackApiEnvelope(json);
  const lastScan = scans[scans.length - 1];
  let topLevelStatus: string | undefined;
  if (json && typeof json === "object") {
    const root = json as Record<string, unknown>;
    if (typeof root.Status === "string") topLevelStatus = root.Status;
  }
  const statusText =
    statusFromShipment ||
    lastScan?.status ||
    lastScan?.detail ||
    topLevelStatus;

  if (statusText) bumpFlags(statusText);

  return {
    statusText,
    delivered,
    rto,
    scans,
    apiError: env.apiError,
    emptyShipmentData: env.emptyShipmentData,
  };
}

export function formatDelhiverySyncSummary(
  waybill: string,
  parsed: ReturnType<typeof parseDelhiveryTrackSummary>,
): string {
  if (parsed.apiError) {
    return `Delhivery: ${parsed.apiError}`;
  }
  const parts: string[] = [];
  if (parsed.statusText) {
    parts.push(`Current: ${parsed.statusText}`);
  }
  const last = parsed.scans[parsed.scans.length - 1];
  if (last) {
    const bit = [last.status || last.detail, last.location, last.time]
      .filter(Boolean)
      .join(" · ");
    if (bit) parts.push(`Latest event: ${bit}`);
  }
  if (parsed.emptyShipmentData && !parsed.statusText && parsed.scans.length === 0) {
    parts.push(
      "No scan data yet — shipment may still be manifesting; try again in a few minutes.",
    );
  }
  if (parts.length === 0) {
    return `Synced AWB ${waybill} — no detailed status returned yet (check Delhivery dashboard).`;
  }
  return parts.join(" • ");
}

export async function syncDelhiveryOrderById(orderId: string): Promise<{
  updated: boolean;
  summary?: string;
  tracking?: {
    lastStatus?: string;
    scanCount: number;
    lastScan?: DelhiveryScanLine;
    waybill: string;
    usedRefFallback: boolean;
  };
}> {
  if (!delhiveryIsConfigured()) {
    return { updated: false, summary: "Delhivery not configured" };
  }

  const order = await Order.findById(orderId);
  if (!order) return { updated: false, summary: "Order not found" };
  if (order.status === "cancelled" || order.status === "refunded") {
    return { updated: false, summary: "Skip cancelled/refunded" };
  }
  if (!order.trackingNumber || !carrierIsDelhivery(order.shippingCarrier)) {
    return { updated: false, summary: "Not a Delhivery shipment" };
  }

  const wb = order.trackingNumber.trim();
  const refId = order.orderNumber?.trim();

  let json: unknown;
  let usedRefFallback = false;
  try {
    json = await trackPackages({ waybill: wb });
    let parsed = parseDelhiveryTrackSummary(json);
    const thin =
      !parsed.statusText &&
      parsed.scans.length === 0 &&
      !parsed.apiError &&
      refId;

    if (thin) {
      const json2 = await trackPackages({ refIds: refId });
      const p2 = parseDelhiveryTrackSummary(json2);
      if (p2.statusText || p2.scans.length > 0 || p2.apiError) {
        json = json2;
        parsed = p2;
        usedRefFallback = true;
      }
    }

    const summary = formatDelhiverySyncSummary(wb, parsed);

    const d =
      order.delhivery && typeof order.delhivery === "object" ?
        (order.delhivery as Record<string, unknown>)
      : {};
    const nextDel: Record<string, unknown> = {
      ...d,
      lastTrackSyncAt: new Date(),
      lastPackageStatus: parsed.statusText,
      lastTrackSummary: summary,
      trackScansSnapshot: parsed.scans.slice(-30),
    };
    if (parsed.rto && order.status === "shipped") {
      nextDel.rtoDetected = true;
    }
    order.set("delhivery", nextDel);

    let statusChanged = false;
    if (parsed.delivered && order.status !== "delivered") {
      order.status = "delivered";
      order.deliveredAt = new Date();
      order.paymentStatus = order.paymentMethod === "cod" ? "paid" : order.paymentStatus;
      if (!order.invoice?.isGenerated) {
        order.invoice = { isGenerated: true, generatedAt: new Date() };
      }
      order.statusHistory.push({
        status: "delivered",
        timestamp: new Date(),
        note: "Auto-updated from Delhivery tracking",
      });
      statusChanged = true;
    }

    await order.save();

    if (statusChanged) {
      const populated = await Order.findById(order._id).populate("user", "name email");
      const user = populated?.user as unknown as { name?: string; email?: string; _id?: string } | undefined;
      if (populated && user?.email) {
        const tpl = emailTemplates.orderStatusUpdate(
          user.name || "Customer",
          populated.orderNumber,
          "delivered",
          undefined,
        );
        await enqueueEmail({ to: user.email, subject: tpl.subject, html: tpl.html });
        await notifyUser(
          populated.user._id,
          `Order ${populated.orderNumber} delivered`,
          "Your order has been delivered. We hope you love it!",
          `/dashboard/orders/${populated._id}`,
          "success",
        );
      }
    }

    const lastSc = parsed.scans[parsed.scans.length - 1];
    return {
      updated: true,
      summary,
      tracking: {
        lastStatus: parsed.statusText,
        scanCount: parsed.scans.length,
        lastScan: lastSc,
        waybill: wb,
        usedRefFallback,
      },
    };
  } catch (e) {
    logger.warn(`Delhivery track failed for ${order.orderNumber}: ${(e as Error).message}`);
    return { updated: false, summary: (e as Error).message };
  }
}

export async function runDelhiveryTrackingSyncJob(): Promise<void> {
  if (!delhiveryIsConfigured()) return;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const orders = await Order.find({
    status: "shipped",
    shippedAt: { $gte: since },
    trackingNumber: { $exists: true, $ne: "" },
    shippingCarrier: { $regex: /delhivery/i },
  })
    .select("_id orderNumber")
    .limit(80)
    .lean();

  for (const o of orders) {
    try {
      await syncDelhiveryOrderById(String(o._id));
    } catch (e) {
      logger.warn(
        `Delhivery sync job error ${o.orderNumber}: ${(e as Error).message}`,
      );
    }
  }
}
