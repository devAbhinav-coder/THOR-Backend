import { Request, Response, NextFunction } from "express";
import catchAsync from "../utils/catchAsync";
import AppError from "../utils/AppError";
import { sendSuccess } from "../utils/response";
import Order from "../models/Order";
import {
  delhiveryIsConfigured,
  delhiveryPickupLocationName,
  delhiveryOriginPincode,
  delhiveryTrackingPublicUrl,
  delhiveryBaseUrl,
} from "../config/delhivery";
import {
  checkPincodeServiceability,
  fetchBulkWaybills,
  fetchSingleWaybill,
  createCmuShipment,
  estimateShippingCharges,
  fetchTatHint,
  sanitizeManifestText,
  chargeableWeightGrams,
  perBoxDeadWeightGm,
  parseCreateShipmentResult,
  fetchPackingSlipPdfUrl,
  fetchPackingSlipJson,
  fetchRemotePdfBuffer,
  DelhiveryApiError,
  type DelhiveryManifestShipment,
} from "../services/delhiveryService";
import { syncDelhiveryOrderById } from "../services/delhiveryTrackingSyncService";
import { writeAdminAudit } from "../services/adminAuditService";
import { enqueueEmail } from "../queues/emailQueue";
import { emailTemplates } from "../services/emailService";
import { notifyUser } from "../services/notificationService";
import { IAddress } from "../types";

function maskConfig() {
  return {
    configured: delhiveryIsConfigured(),
    baseUrl: delhiveryBaseUrl(),
    pickupLocationName: delhiveryPickupLocationName() || null,
    originPincode: delhiveryOriginPincode() || null,
  };
}

export const getDelhiveryIntegrationStatus = catchAsync(
  async (_req: Request, res: Response) => {
    sendSuccess(res, maskConfig());
  },
);

export const checkOrderPinServiceability = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));
    const pin = order.shippingAddress?.pincode;
    if (!pin) return next(new AppError("Order has no destination pincode.", 400));
    try {
      const r = await checkPincodeServiceability(pin);
      sendSuccess(res, {
        pin,
        serviceable: r.serviceable,
        remark: r.remark,
        raw: process.env.NODE_ENV === "development" ? r.raw : undefined,
      });
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 503) {
        return next(new AppError("Delhivery integration is not configured.", 503));
      }
      throw e;
    }
  },
);

/** Check any 6-digit PIN against Delhivery network (admin tool — support / pre-check). */
export const checkDelhiveryServiceabilityByPin = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const pin = String(req.query.pin || "").trim();
    if (!/^\d{6}$/.test(pin)) {
      return next(new AppError("Enter a valid 6-digit pincode.", 400));
    }
    try {
      const r = await checkPincodeServiceability(pin);
      sendSuccess(res, {
        pin,
        serviceable: r.serviceable,
        remark: r.remark,
        raw: process.env.NODE_ENV === "development" ? r.raw : undefined,
      });
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 503) {
        return next(new AppError("Delhivery integration is not configured.", 503));
      }
      throw e;
    }
  },
);

function formatShipAddress(a: IAddress): string {
  const parts = [a.house, a.street, a.landmark ? `Landmark: ${a.landmark}` : "", a.city, a.state, a.pincode]
    .filter(Boolean)
    .join(", ");
  return sanitizeManifestText(parts);
}

function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length >= 10) return d.slice(-10);
  return d;
}

/** First Kinko row’s `charged_weight` is Delhivery’s billed weight for that quote. */
function extractKinkoChargedWeightGm(charges: unknown): number | undefined {
  if (charges == null) return undefined;
  const row =
    Array.isArray(charges) && charges[0] && typeof charges[0] === "object" ?
      (charges[0] as Record<string, unknown>)
    : typeof charges === "object" && !Array.isArray(charges) ?
      (charges as Record<string, unknown>)
    : null;
  if (!row) return undefined;
  const cw = row.charged_weight;
  if (typeof cw === "number" && Number.isFinite(cw)) return Math.round(cw);
  return undefined;
}

export const estimateDelhiveryForOrder = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      md,
      lengthCm,
      breadthCm,
      heightCm,
      weightGm,
      ipkg_type,
      boxCount: boxCountRaw,
    } = req.body as {
      md: "E" | "S";
      lengthCm: number;
      breadthCm: number;
      heightCm: number;
      weightGm: number;
      ipkg_type?: "box" | "flyer";
      boxCount?: number;
    };

    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));

    const oPin = delhiveryOriginPincode();
    if (!oPin || !delhiveryIsConfigured()) {
      return next(new AppError("Delhivery integration is not configured.", 503));
    }

    const dPin = order.shippingAddress?.pincode?.replace(/\D/g, "").slice(0, 6);
    if (!dPin || dPin.length !== 6) {
      return next(new AppError("Invalid destination pincode on order.", 400));
    }

    const l = Number(lengthCm);
    const b = Number(breadthCm);
    const h = Number(heightCm);
    const w = Number(weightGm);
    if ([l, b, h, w].some((x) => !Number.isFinite(x) || x <= 0)) {
      return next(new AppError("Dimensions and weight must be positive numbers.", 400));
    }
    if (l + b + h < 15) {
      return next(new AppError("Length + breadth + height must be at least 15 cm (Delhivery).", 400));
    }
    if (w < 50) {
      return next(new AppError("Package weight must be at least 50 g (Delhivery).", 400));
    }

    const boxes = Math.min(5, Math.max(1, Math.floor(Number(boxCountRaw) || 1)));
    const perBoxDead = perBoxDeadWeightGm(w, boxes);
    const cgm = chargeableWeightGrams(l, b, h, perBoxDead);
    const pt = order.paymentMethod === "cod" ? "COD" : ("Pre-paid" as const);

    let chargesJson: unknown;
    try {
      chargesJson = await estimateShippingCharges({
        md,
        cgm,
        o_pin: oPin,
        d_pin: dPin,
        pt,
        l,
        b,
        h,
        ipkg_type,
      });
    } catch (e) {
      const err = e as { message?: string; statusCode?: number };
      return next(new AppError(err.message || "Delhivery charges request failed", err.statusCode || 502));
    }

    const tat = await fetchTatHint({
      origin_pin: oPin,
      destination_pin: dPin,
      mot: md === "E" ? "E" : "S",
    });

    const chargedFromQuote = extractKinkoChargedWeightGm(chargesJson);

    sendSuccess(res, {
      boxCount: boxes,
      /** Dead weight per box (g) — same as manifest when you create shipment */
      perBoxDeadWeightGm: perBoxDead,
      /** cgm we computed and sent as the `cgm` query param (chargeable per box) */
      cgmRequested: cgm,
      /** Delhivery’s own charged_weight from the quote row, when present */
      chargedWeightDelhivery: chargedFromQuote,
      /** Canonical weight for this quote: Delhivery row, else our cgm */
      chargeableWeightGm: chargedFromQuote ?? cgm,
      charges: chargesJson,
      tatDays: tat.tatDays,
      tatRaw: tat.ok ? tat.raw : undefined,
    });
  },
);

export const createDelhiveryShipmentForOrder = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      shippingMode,
      lengthCm,
      breadthCm,
      heightCm,
      weightGm,
      ipkg_type,
      boxCount,
    } = req.body as {
      shippingMode: "Surface" | "Express";
      lengthCm: number;
      breadthCm: number;
      heightCm: number;
      weightGm: number;
      ipkg_type?: "box" | "flyer";
      boxCount?: number;
    };

    const pickupName = delhiveryPickupLocationName();
    const oPin = delhiveryOriginPincode();
    if (!pickupName || !oPin || !delhiveryIsConfigured()) {
      return next(new AppError("Delhivery integration is not configured.", 503));
    }

    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));

    if (order.status === "cancelled" || order.status === "refunded") {
      return next(new AppError("Cannot ship a cancelled or refunded order.", 400));
    }
    if (order.status === "shipped" || order.status === "delivered") {
      return next(new AppError("Order is already shipped or delivered.", 400));
    }
    if (!["confirmed", "processing"].includes(order.status)) {
      return next(
        new AppError(
          "Move the order to Confirmed or Processing before creating a Delhivery shipment.",
          400,
        ),
      );
    }

    const l = Number(lengthCm);
    const b = Number(breadthCm);
    const h = Number(heightCm);
    const totalW = Number(weightGm);
    const boxes = Math.min(5, Math.max(1, Math.floor(Number(boxCount) || 1)));

    if (boxes > 1 && order.paymentMethod === "cod") {
      return next(
        new AppError(
          "Multi-box (MPS) with COD is not supported in automation — use one box or enter tracking manually.",
          400,
        ),
      );
    }

    if ([l, b, h, totalW].some((x) => !Number.isFinite(x) || x <= 0)) {
      return next(new AppError("Dimensions and weight must be positive numbers.", 400));
    }
    if (l + b + h < 15) {
      return next(new AppError("Length + breadth + height must be at least 15 cm (Delhivery).", 400));
    }
    if (totalW < 50) {
      return next(new AppError("Package weight must be at least 50 g (Delhivery).", 400));
    }

    const destPin = order.shippingAddress?.pincode?.replace(/\D/g, "").slice(0, 6);
    if (!destPin || destPin.length !== 6) {
      return next(new AppError("Invalid destination pincode.", 400));
    }

    const pinCheck = await checkPincodeServiceability(destPin);
    if (!pinCheck.serviceable) {
      return next(
        new AppError(
          `Destination pincode is not serviceable${pinCheck.remark ? `: ${pinCheck.remark}` : ""}.`,
          400,
        ),
      );
    }

    const perBoxWeight = perBoxDeadWeightGm(totalW, boxes);
    const cgm = chargeableWeightGrams(l, b, h, perBoxWeight);

    const phone = normalizePhone(order.shippingAddress.phone || "");
    if (phone.length !== 10) {
      return next(new AppError("Consignee phone must be a valid 10-digit Indian mobile.", 400));
    }

    const addr = formatShipAddress(order.shippingAddress as IAddress);
    if (addr.length < 8) {
      return next(new AppError("Shipping address is too short for Delhivery.", 400));
    }

    const names = order.items.map((i) => i.name).join(", ");
    const productsDesc = sanitizeManifestText(names).slice(0, 450);

    const paymentMode = order.paymentMethod === "cod" ? "COD" : "Prepaid";
    const codAmount =
      order.paymentMethod === "cod" ? String(Math.round(order.total * 100) / 100) : "";

    const waybills =
      boxes === 1 ? [await fetchSingleWaybill()] : await fetchBulkWaybills(boxes);

    const shipments: DelhiveryManifestShipment[] = [];

    if (boxes === 1) {
      shipments.push({
        name: sanitizeManifestText(order.shippingAddress.name).slice(0, 100),
        add: addr.slice(0, 450),
        pin: destPin,
        city: sanitizeManifestText(order.shippingAddress.city).slice(0, 80),
        state: sanitizeManifestText(order.shippingAddress.state).slice(0, 80),
        country: "India",
        phone,
        order: order.orderNumber,
        payment_mode: paymentMode,
        products_desc: productsDesc,
        cod_amount: codAmount,
        total_amount: String(Math.round(order.total * 100) / 100),
        shipping_mode: shippingMode,
        weight: String(perBoxWeight),
        shipment_length: String(l),
        shipment_width: String(b),
        shipment_height: String(h),
        waybill: waybills[0],
        fragile_shipment: "false",
        dangerous_good: "false",
        ...(ipkg_type ? { address_type: "home" } : {}),
      });
    } else {
      const master = waybills[0];
      const mpsChildren = String(boxes);
      const mpsAmount = order.paymentMethod === "cod" ? codAmount : "0";
      for (let i = 0; i < boxes; i++) {
        const suffix = `-B${i + 1}`;
        shipments.push({
          name: sanitizeManifestText(order.shippingAddress.name).slice(0, 100),
          add: addr.slice(0, 450),
          pin: destPin,
          city: sanitizeManifestText(order.shippingAddress.city).slice(0, 80),
          state: sanitizeManifestText(order.shippingAddress.state).slice(0, 80),
          country: "India",
          phone,
          order: `${order.orderNumber}${suffix}`,
          payment_mode: paymentMode,
          products_desc: productsDesc,
          cod_amount: i === 0 ? codAmount : "",
          total_amount: String(Math.round(order.total * 100) / 100),
          shipping_mode: shippingMode,
          weight: String(perBoxWeight),
          shipment_length: String(l),
          shipment_width: String(b),
          shipment_height: String(h),
          waybill: waybills[i],
          shipment_type: "MPS",
          mps_amount: mpsAmount,
          mps_children: mpsChildren,
          master_id: master,
          fragile_shipment: "false",
          dangerous_good: "false",
        });
      }
    }

    let created: unknown;
    try {
      created = await createCmuShipment({
        shipments,
        pickup_location: { name: pickupName },
      });
    } catch (e) {
      const err = e as { message?: string; statusCode?: number; body?: unknown };
      return next(
        new AppError(err.message || "Delhivery create shipment failed", err.statusCode || 502),
      );
    }

    const parsed = parseCreateShipmentResult(created);
    const primaryWb = parsed.waybills[0] || waybills[0];

    if (!primaryWb) {
      return next(
        new AppError(
          parsed.errorMessage || "Delhivery did not return a waybill. Check Delhivery response.",
          502,
        ),
      );
    }

    const trackUrl = delhiveryTrackingPublicUrl(primaryWb);

    order.status = "shipped";
    if (!order.shippedAt) order.shippedAt = new Date();
    order.shippingCarrier = "Delhivery";
    order.trackingNumber = primaryWb;
    order.trackingUrl = trackUrl;

    const tat = await fetchTatHint({
      origin_pin: oPin,
      destination_pin: destPin,
      mot: shippingMode === "Express" ? "E" : "S",
    });

    order.set("delhivery", {
      provider: "delhivery",
      shipmentCreatedAt: new Date(),
      waybills: parsed.waybills.length ? parsed.waybills : waybills,
      masterWaybill: boxes > 1 ? waybills[0] : primaryWb,
      package: {
        shippingMode,
        ipkg_type: ipkg_type || null,
        lengthCm: l,
        breadthCm: b,
        heightCm: h,
        weightGmTotal: totalW,
        boxCount: boxes,
        chargeableWeightGm: cgm,
      },
      estimatedTatDays: tat.tatDays ?? null,
      createResponse:
        process.env.NODE_ENV === "development" ? created : { success: true },
    });

    order.statusHistory.push({
      status: "shipped",
      timestamp: new Date(),
      note: `Delhivery shipment created (AWB ${primaryWb}${boxes > 1 ? `, ${boxes} boxes` : ""})`,
    });

    await order.save();

    await writeAdminAudit(req, "order.delhivery_shipment", {
      orderId: order._id,
      waybill: primaryWb,
      boxes,
    });

    const populated = await Order.findById(order._id).populate("user", "name email");
    const user = populated?.user as unknown as { name?: string; email?: string; _id?: string } | undefined;
    if (populated && user?.email) {
      const tpl = emailTemplates.orderStatusUpdate(
        user.name || "Customer",
        populated.orderNumber,
        "shipped",
        {
          carrier: "Delhivery",
          awb: primaryWb,
          trackingUrl: trackUrl,
        },
      );
      await enqueueEmail({ to: user.email, subject: tpl.subject, html: tpl.html });
      await notifyUser(
        populated.user._id,
        `Order ${populated.orderNumber} is on its way!`,
        `Your order is on its way via Delhivery, AWB: ${primaryWb}.`,
        `/dashboard/orders/${populated._id}`,
        "order",
      );
    }

    sendSuccess(res, { order: populated || order, delhivery: { waybill: primaryWb, trackingUrl: trackUrl } });
  },
);

export const syncDelhiveryTrackingForOrder = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const r = await syncDelhiveryOrderById(req.params.id);
    if (!r.updated) {
      if (r.summary === "Order not found") {
        return next(new AppError("Order not found.", 404));
      }
      if (r.summary === "Delhivery not configured") {
        return next(new AppError("Delhivery integration is not configured.", 503));
      }
      if (r.summary === "Skip cancelled/refunded" || r.summary === "Not a Delhivery shipment") {
        return next(new AppError(r.summary, 400));
      }
      return next(
        new AppError(
          r.summary || "Could not sync tracking from Delhivery.",
          502,
        ),
      );
    }

    await writeAdminAudit(req, "order.delhivery_sync", {
      orderId: req.params.id,
      summary: r.summary,
    });
    const order = await Order.findById(req.params.id);
    sendSuccess(res, {
      summary: r.summary,
      tracking: r.tracking,
      order,
    });
  },
);

export const getDelhiveryPackingSlip = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!delhiveryIsConfigured()) {
      return next(new AppError("Delhivery integration is not configured.", 503));
    }
    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));

    const carrier = (order.shippingCarrier || "").toLowerCase();
    if (!carrier.includes("delhivery")) {
      return next(
        new AppError(
          "Shipping labels are only available for Delhivery shipments.",
          400,
        ),
      );
    }
    const waybill = order.trackingNumber?.trim();
    if (!waybill || waybill.length < 6) {
      return next(new AppError("This order has no Delhivery waybill (AWB).", 400));
    }

    const rawSize = String(req.query.pdf_size || "4R").toUpperCase();
    const pdfSize = rawSize === "A4" ? ("A4" as const) : ("4R" as const);

    try {
      const { pdfUrl, raw } = await fetchPackingSlipPdfUrl({
        waybill,
        pdfSize,
      });
      await writeAdminAudit(req, "order.delhivery_packing_slip", {
        orderId: order._id,
        waybill,
        pdfSize,
      });
      sendSuccess(res, {
        pdfUrl,
        waybill,
        pdfSize,
        ...(process.env.NODE_ENV === "development" ? { raw } : {}),
      });
    } catch (e) {
      if (e instanceof DelhiveryApiError) {
        if (e.statusCode === 503) {
          return next(new AppError("Delhivery integration is not configured.", 503));
        }
        return next(
          new AppError(
            e.message,
            e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 502,
          ),
        );
      }
      return next(
        new AppError(
          (e as Error).message || "Could not generate packing slip from Delhivery.",
          502,
        ),
      );
    }
  },
);

/** Delhivery packing slip with pdf=false — raw JSON for custom HTML / Code 128 layouts. */
export const getDelhiveryPackingSlipJson = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!delhiveryIsConfigured()) {
      return next(new AppError("Delhivery integration is not configured.", 503));
    }
    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));

    const carrier = (order.shippingCarrier || "").toLowerCase();
    if (!carrier.includes("delhivery")) {
      return next(
        new AppError(
          "Shipping labels are only available for Delhivery shipments.",
          400,
        ),
      );
    }
    const waybill = order.trackingNumber?.trim();
    if (!waybill || waybill.length < 6) {
      return next(new AppError("This order has no Delhivery waybill (AWB).", 400));
    }

    const rawSize = String(req.query.pdf_size || "4R").toUpperCase();
    const pdfSize = rawSize === "A4" ? ("A4" as const) : ("4R" as const);

    try {
      const payload = await fetchPackingSlipJson({ waybill, pdfSize });
      await writeAdminAudit(req, "order.delhivery_packing_slip_json", {
        orderId: order._id,
        waybill,
        pdfSize,
      });
      sendSuccess(res, {
        waybill,
        pdfSize,
        payload,
      });
    } catch (e) {
      if (e instanceof DelhiveryApiError) {
        if (e.statusCode === 503) {
          return next(new AppError("Delhivery integration is not configured.", 503));
        }
        return next(
          new AppError(
            e.message,
            e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 502,
          ),
        );
      }
      return next(
        new AppError(
          (e as Error).message || "Could not load packing slip JSON from Delhivery.",
          502,
        ),
      );
    }
  },
);

/** Stream PDF through our API — correct file on download/print; avoids wrong link from JSON. */
export const downloadDelhiveryPackingSlipFile = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!delhiveryIsConfigured()) {
      return next(new AppError("Delhivery integration is not configured.", 503));
    }
    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));

    const carrier = (order.shippingCarrier || "").toLowerCase();
    if (!carrier.includes("delhivery")) {
      return next(
        new AppError(
          "Shipping labels are only available for Delhivery shipments.",
          400,
        ),
      );
    }
    const waybill = order.trackingNumber?.trim();
    if (!waybill || waybill.length < 6) {
      return next(new AppError("This order has no Delhivery waybill (AWB).", 400));
    }

    const rawSize = String(req.query.pdf_size || "4R").toUpperCase();
    const pdfSize = rawSize === "A4" ? ("A4" as const) : ("4R" as const);

    try {
      const { pdfUrl } = await fetchPackingSlipPdfUrl({
        waybill,
        pdfSize,
      });
      const { buffer, contentType } = await fetchRemotePdfBuffer(pdfUrl);
      await writeAdminAudit(req, "order.delhivery_packing_slip_download", {
        orderId: order._id,
        waybill,
        pdfSize,
      });
      const filename = `delhivery-label-${waybill}-${pdfSize}.pdf`;
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename.replace(/"/g, "")}"`,
      );
      res.setHeader("Content-Length", String(buffer.length));
      res.send(buffer);
    } catch (e) {
      if (e instanceof DelhiveryApiError) {
        if (e.statusCode === 503) {
          return next(new AppError("Delhivery integration is not configured.", 503));
        }
        return next(
          new AppError(
            e.message,
            e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 502,
          ),
        );
      }
      return next(
        new AppError(
          (e as Error).message || "Could not download packing slip PDF.",
          502,
        ),
      );
    }
  },
);
