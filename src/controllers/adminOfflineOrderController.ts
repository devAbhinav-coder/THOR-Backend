import mongoose from "mongoose";
import { Response, NextFunction } from "express";
import Order from "../models/Order";
import User from "../models/User";
import Product from "../models/Product";
import Category from "../models/Category";
import AppError from "../types/utils/AppError";
import catchAsync from "../types/utils/catchAsync";
import type { AuthRequest, IOrderItem } from "../types";
import { computeOrderTotals } from "../services/orderService";
import {
  decrementVariantStock,
  incrementVariantStock,
  logStockMovement,
} from "../services/inventoryService";
import { sendSuccess } from "../types/utils/response";
import { writeAdminAudit } from "../services/adminAuditService";
import { sendOfflineOrderCreatedCustomerNotifications } from "../services/orders/offlineOrderNotificationService";
import { emailTemplates } from "../services/emailService";
import {
  notifyAdmins,
  notifyUser,
  notifyAdminsEmail,
} from "../services/notificationService";
import {
  getOfflineHandoverCopy,
  getOfflineShipLaterCopy,
} from "../services/notifications/orderNotificationCopy";
import {
  getOrCreateOfflineManualProduct,
  isOfflineManualProductId,
  OFFLINE_MANUAL_VARIANT_SKU,
} from "../services/offlineManualProductService";
import { resolveOfflineManualLineImage } from "../constants/offlineOrder";
import {
  removeOfflineCustomerByEmail,
  upsertOfflineCustomerRecord,
} from "../services/offlineCustomerService";
function normalizeInPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  if (d.length === 10) return d;
  return d.slice(-10);
}

function isGiftCategoryDoc(cat: {
  name?: string;
  slug?: string;
  isGiftCategory?: boolean;
}): boolean {
  if (cat.isGiftCategory) return true;
  const n = String(cat.name || "").toLowerCase();
  const s = String(cat.slug || "").toLowerCase();
  return n.includes("gift") || n.includes("gifting") || s.includes("gift");
}

function randomStrongPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  let pw = "";
  pw += upper[Math.floor(Math.random() * upper.length)]!;
  pw += lower[Math.floor(Math.random() * lower.length)]!;
  pw += digits[Math.floor(Math.random() * digits.length)]!;
  for (let i = 0; i < 21; i++)
    pw += all[Math.floor(Math.random() * all.length)]!;
  return pw;
}

function resolveUnitCostAtSale(
  adminUnitCost: number | undefined | null,
  variantCostPrice: number | undefined | null,
): number {
  if (
    adminUnitCost !== undefined &&
    adminUnitCost !== null &&
    Number.isFinite(Number(adminUnitCost))
  ) {
    return Math.max(0, Number(adminUnitCost));
  }
  const fromVariant = Number(variantCostPrice ?? 0);
  return Number.isFinite(fromVariant) && fromVariant >= 0 ? fromVariant : 0;
}

type LineIn =
  | {
      type: "catalog";
      productId: string;
      variantSku: string;
      quantity: number;
      unitPrice?: number;
      unitCost?: number;
    }
  | {
      type: "manual";
      categoryId?: string;
      title?: string;
      quantity: number;
      unitPrice: number;
      unitCost?: number;
    };

type AddrIn = {
  name?: string;
  phone?: string;
  house?: string;
  street: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
};

/**
 * Admin-only: create a confirmed, paid offline sale (stall / personal contact)
 * with optional Delhivery fulfillment later.
 */
export const createOfflineOrder = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const body = req.body as {
      customerName: string;
      email: string;
      phone: string;
      orderSource: "stall" | "personal_contact" | "b2b";
      fulfillment: "delhivery" | "offline_handover";
      paymentMethod: "offline_upi" | "offline_cash";
      shippingAddress?: AddrIn;
      lineItems: LineIn[];
      notes?: string;
      b2bMeta?: {
        companyName?: string;
        gstin?: string;
        poNumber?: string;
      };
    };

    const {
      customerName,
      email,
      phone,
      orderSource,
      fulfillment,
      paymentMethod,
      shippingAddress: shipIn,
      lineItems,
      notes,
      b2bMeta,
    } = body;

    if (orderSource === "b2b" && b2bMeta?.gstin?.trim()) {
      const gst = b2bMeta.gstin.trim().toUpperCase();
      if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(gst)) {
        return next(new AppError("Invalid buyer GSTIN format.", 400));
      }
    }

    const phone10 = phone ? normalizeInPhone(String(phone)) : "";
    if (phone && !/^[6-9]\d{9}$/.test(phone10)) {
      return next(
        new AppError("If provided, phone must be a valid 10-digit Indian mobile number.", 400),
      );
    }

    if (fulfillment === "delhivery") {
      if (
        !shipIn?.street?.trim() ||
        !shipIn.city?.trim() ||
        !shipIn.state?.trim()
      ) {
        return next(
          new AppError(
            "Shipping address (street, city, state, pincode) is required for Delhivery delivery.",
            400,
          ),
        );
      }
      const pin = String(shipIn.pincode || "")
        .replace(/\D/g, "")
        .slice(0, 6);
      if (!/^\d{6}$/.test(pin)) {
        return next(
          new AppError(
            "Valid 6-digit pincode is required for Delhivery delivery.",
            400,
          ),
        );
      }
    }

    const offlineManualProduct = await getOrCreateOfflineManualProduct();
    const offlinePid = offlineManualProduct._id as mongoose.Types.ObjectId;

    const orderItems: IOrderItem[] = [];
    let subtotal = 0;

    const catalogStockOps: {
      productId: mongoose.Types.ObjectId;
      sku: string;
      qty: number;
    }[] = [];

    for (const line of lineItems) {
      if (line.type === "manual") {
        const qty = Math.max(
          1,
          Math.min(50, Math.floor(Number(line.quantity))),
        );
        const unit = Math.max(0, Number(line.unitPrice));
        if (!Number.isFinite(unit)) {
          return next(new AppError("Invalid unit price on manual line.", 400));
        }

        let lineName: string;
        let categoryImage = "";

        const catIdRaw =
          typeof line.categoryId === "string" ? line.categoryId.trim() : "";
        if (catIdRaw) {
          if (!mongoose.Types.ObjectId.isValid(catIdRaw)) {
            return next(
              new AppError("Invalid category id on manual line.", 400),
            );
          }
          const cat = await Category.findById(catIdRaw).lean();
          if (!cat || !cat.isActive) {
            return next(new AppError("Category not found or inactive.", 400));
          }
          if (isGiftCategoryDoc(cat)) {
            return next(
              new AppError(
                "Gift / gifting categories cannot be used for offline manual lines. Pick a shop category or use a custom description.",
                400,
              ),
            );
          }
          lineName = String(cat.name || "")
            .trim()
            .slice(0, 200);
          if (!lineName) {
            return next(new AppError("Category has no usable name.", 400));
          }
          const cimg =
            typeof cat.image === "string" && cat.image.trim() ?
              cat.image.trim()
            : "";
          if (cimg) categoryImage = cimg;
        } else {
          lineName = String(line.title || "")
            .trim()
            .slice(0, 200);
          if (!lineName) {
            return next(
              new AppError(
                "Manual line needs a shop category or a custom description.",
                400,
              ),
            );
          }
        }

        subtotal += unit * qty;
        const costAtSale = resolveUnitCostAtSale(line.unitCost, undefined);
        orderItems.push({
          product: offlinePid,
          name: lineName,
          slug: "offline-manual-item",
          image: resolveOfflineManualLineImage(categoryImage),
          variant: { sku: OFFLINE_MANUAL_VARIANT_SKU },
          quantity: qty,
          price: unit,
          costAtSale,
          lineCategory: lineName,
          ...(catIdRaw ?
            { lineCategoryId: new mongoose.Types.ObjectId(catIdRaw) }
          : {}),
          isOfflineManual: true,
        });
        continue;
      }

      if (!mongoose.Types.ObjectId.isValid(line.productId)) {
        return next(new AppError("Invalid product id in catalog line.", 400));
      }
      const pid = new mongoose.Types.ObjectId(line.productId);
      if (isOfflineManualProductId(pid, offlinePid)) {
        return next(
          new AppError(
            "Use a manual line item instead of the system placeholder product.",
            400,
          ),
        );
      }

      const product = await Product.findById(pid);
      if (!product || !product.isActive) {
        return next(
          new AppError("One of the selected products is not available.", 400),
        );
      }

      const sku = String(line.variantSku || "").trim();
      const variant = product.variants.find((v) => v.sku === sku);
      if (!variant) {
        return next(
          new AppError(`Variant not found for ${product.name}.`, 400),
        );
      }

      const qty = Math.max(1, Math.min(50, Math.floor(Number(line.quantity))));
      if (variant.stock < qty) {
        return next(
          new AppError(
            `Insufficient stock for "${product.name}" (${variant.sku}).`,
            400,
          ),
        );
      }

      const listed =
        typeof variant.price === "number" && variant.price >= 0 ?
          variant.price
        : product.price;
      const unit =
        line.unitPrice !== undefined && line.unitPrice !== null ?
          Math.max(0, Number(line.unitPrice))
        : listed;
      if (!Number.isFinite(unit)) {
        return next(new AppError("Invalid unit price on catalog line.", 400));
      }

      subtotal += unit * qty;
      const img = product.images[0]?.url;
      if (!img) {
        return next(
          new AppError(`Product "${product.name}" has no image.`, 400),
        );
      }

      const costAtSale = resolveUnitCostAtSale(line.unitCost, variant.costPrice);

      orderItems.push({
        product: pid,
        name: product.name,
        slug: product.slug || "unknown",
        image: img,
        variant: {
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
        },
        quantity: qty,
        price: unit,
        costAtSale,
        lineCategory: product.category,
      });
      catalogStockOps.push({ productId: pid, sku: variant.sku, qty });
    }

    if (orderItems.length === 0) {
      return next(new AppError("At least one line item is required.", 400));
    }

    let { shippingCharge, tax, total, codFee } = computeOrderTotals(
      subtotal,
      0,
      paymentMethod,
    );
    /** In-person handover: no courier — no shipping line on the order. */
    if (fulfillment === "offline_handover") {
      shippingCharge = 0;
      total = Math.round((subtotal + tax + codFee) * 100) / 100;
    }

    const isHandover = fulfillment === "offline_handover";
    const paymentLabel =
      paymentMethod === "offline_upi" ? "UPI (paid at sale)" : (
        "Cash (paid at sale)"
      );
    const emailLineItems = orderItems.map((i) => ({
      name: i.name,
      qty: i.quantity,
      lineTotal: Math.round(i.price * i.quantity * 100) / 100,
    }));

    const hasEmail = Boolean(email && email.trim() !== "");
    const emailNorm = hasEmail
      ? String(email).trim().toLowerCase()
      : `guest_${Date.now()}_${Math.floor(Math.random() * 1000)}@offline.local`;

    let user = await User.findOne({ email: emailNorm });
    if (!user) {
      try {
        const payload: any = {
          name: customerName.trim().slice(0, 50),
          email: emailNorm,
          password: randomStrongPassword(),
          offlineLead: true,
        };
        if (phone10) payload.phone = phone10;

        user = await User.create(payload);
      } catch (err: unknown) {
        const code = (err as { code?: number })?.code;
        if (code === 11000 && hasEmail) {
          user = await User.findOne({ email: emailNorm });
        }
        if (!user) throw err;
      }
    }
    if (!user) {
      return next(
        new AppError("Could not create or load customer account.", 500),
      );
    }

    user.name = customerName.trim().slice(0, 50);
    if (phone10) user.phone = phone10;
    await user.save();

    const isOfflineMarketingLead = Boolean(
      (user as { offlineLead?: boolean }).offlineLead,
    );
    if (!isOfflineMarketingLead && hasEmail) {
      await removeOfflineCustomerByEmail(emailNorm);
    }

    const shipAddr =
      fulfillment === "delhivery" && shipIn ?
        {
          name: (shipIn.name || customerName).trim().slice(0, 80),
          phone: normalizeInPhone(String(shipIn.phone || phone10)),
          label: "Shipping",
          house: shipIn.house?.trim(),
          street: shipIn.street.trim(),
          landmark: shipIn.landmark?.trim(),
          city: shipIn.city.trim(),
          state: shipIn.state.trim(),
          pincode: String(shipIn.pincode).replace(/\D/g, "").slice(0, 6),
          country: (shipIn.country || "India").trim() || "India",
        }
      : {
          name: customerName.trim().slice(0, 80),
          phone: phone10 || "0000000000",
          label: "Customer",
          street:
            "In-person fulfilment — goods handed over at point of sale (no courier dispatch for this order).",
          city: "Fulfilled in person",
          state: "India",
          pincode: "110001",
          country: "India",
        };

    if (fulfillment === "delhivery") {
      const shipPhone = String(shipAddr.phone || "")
        .replace(/\D/g, "")
        .slice(-10);
      if (!/^[6-9]\d{9}$/.test(shipPhone)) {
        return next(
          new AppError(
            "Shipping phone must be a valid 10-digit Indian number.",
            400,
          ),
        );
      }
      shipAddr.phone = shipPhone;
    }

    const decremented: {
      productId: mongoose.Types.ObjectId;
      sku: string;
      qty: number;
    }[] = [];
    try {
      for (const op of catalogStockOps) {
        const ok = await decrementVariantStock(op.productId, op.sku, op.qty);
        if (!ok) {
          throw new AppError(
            "Could not reserve stock (concurrent sale?). Retry.",
            409,
          );
        }
        decremented.push({
          productId: op.productId,
          sku: op.sku,
          qty: op.qty,
        });
      }

      const adminId = req.user?._id as mongoose.Types.ObjectId | undefined;

      const order = await Order.create({
        user: user._id,
        items: orderItems,
        shippingAddress: shipAddr,
        status: isHandover ? "delivered" : "confirmed",
        paymentStatus: "paid",
        paymentMethod,
        inventoryReserved: catalogStockOps.length > 0,
        subtotal,
        discount: 0,
        shippingCharge,
        codFee,
        tax,
        total,
        notes: notes?.trim()?.slice(0, 2000) || undefined,
        offlineMeta: {
          source: orderSource,
          fulfillment,
          createdByAdmin: adminId,
        },
        ...(orderSource === "b2b" && b2bMeta ?
          {
            b2bMeta: {
              ...(b2bMeta.companyName?.trim() ?
                { companyName: b2bMeta.companyName.trim().slice(0, 120) }
              : {}),
              ...(b2bMeta.gstin?.trim() ?
                { gstin: b2bMeta.gstin.trim().toUpperCase().slice(0, 20) }
              : {}),
              ...(b2bMeta.poNumber?.trim() ?
                { poNumber: b2bMeta.poNumber.trim().slice(0, 60) }
              : {}),
            },
          }
        : {}),
        ...(isHandover ?
          {
            deliveredAt: new Date(),
            invoice: { isGenerated: true, generatedAt: new Date() },
          }
        : {}),
      });

      const channelLabel =
        orderSource === "b2b" ? "B2B"
        : orderSource === "stall" ? "Offline"
        : "Offline";
      for (const op of decremented) {
        await logStockMovement(op.productId, op.sku, -op.qty, {
          reason: "sale",
          referenceId: String(order._id),
          referenceType: "order",
          actor: adminId,
          note: `${channelLabel} order ${order.orderNumber}`,
        }).catch((err) => console.error("Stock ledger fail (admin sale):", err));
      }

      await writeAdminAudit(
        req,
        "order.offline_created",
        {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          fulfillment,
          orderSource,
          paymentMethod,
        },
        String(user._id),
      );

      void sendOfflineOrderCreatedCustomerNotifications({
        orderId: String(order._id),
        userId: String(user._id),
        isHandover,
        fulfillment,
        paymentLabel,
        emailLineItems,
      }).catch((err) => {
        console.error("Offline order customer notifications failed:", err);
      });

      /* Admin alerts below — customer pack above handles PDF, WhatsApp, review */
      const adminTemplate = emailTemplates.adminNewOrder(
        order.orderNumber,
        order.total,
        user.name,
        user.email,
      );
      await notifyAdminsEmail(adminTemplate.subject, adminTemplate.html);

      await notifyAdmins(
        orderSource === "b2b" ? "B2B order recorded" : "Offline order recorded",
        `Order ${order.orderNumber} (${paymentMethod}, ${fulfillment}) for ${user.name}.`,
        `/admin/orders/${order._id}`,
        "order",
      );

      const offlineCopy =
        isHandover ?
          getOfflineHandoverCopy(order.orderNumber)
        : getOfflineShipLaterCopy(order.orderNumber);
      notifyUser(
        String(user._id),
        offlineCopy.title,
        offlineCopy.message,
        `/dashboard/orders/${order._id}`,
        offlineCopy.type,
      ).catch(() => {});

      if (isOfflineMarketingLead && hasEmail && phone10) {
        await upsertOfflineCustomerRecord({
          email: emailNorm,
          phone: phone10,
          name: customerName.trim().slice(0, 50),
        });
      }

      sendSuccess(
        res,
        { order: order.toJSON() },
        orderSource === "b2b" ? "B2B order created" : "Offline order created",
        201,
      );
    } catch (err) {
      for (const d of decremented.reverse()) {
        await incrementVariantStock(d.productId, d.sku, d.qty, {
          soldCountDelta: -d.qty,
        }).catch(() => {});
        await logStockMovement(d.productId, d.sku, d.qty, {
          reason: "manual_correction",
          note: "Admin channel order creation rollback",
        }).catch(() => {});
      }
      throw err;
    }
  },
);

/** B2B orders that do not yet have a linked GST tax invoice (for admin invoice picker). */
export const listB2bOrdersPendingTaxInvoice = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const search = String(req.query.search || "").trim();
    const limit = Math.min(
      50,
      Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25),
    );

    const filter: Record<string, unknown> = {
      "offlineMeta.source": "b2b",
      $or: [
        { taxSalesInvoiceId: { $exists: false } },
        { taxSalesInvoiceId: null },
      ],
    };

    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$and = [
        {
          $or: [
            { orderNumber: { $regex: safe, $options: "i" } },
            { "b2bMeta.companyName": { $regex: safe, $options: "i" } },
            { "b2bMeta.gstin": { $regex: safe, $options: "i" } },
            { "shippingAddress.name": { $regex: safe, $options: "i" } },
          ],
        },
      ];
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(
        "orderNumber total createdAt b2bMeta shippingAddress.name paymentStatus status",
      )
      .lean();

    sendSuccess(res, {
      orders: orders.map((o) => ({
        _id: String(o._id),
        orderNumber: o.orderNumber,
        total: o.total,
        createdAt: o.createdAt,
        companyName: o.b2bMeta?.companyName || "",
        gstin: o.b2bMeta?.gstin || "",
        buyerName: o.shippingAddress?.name || "",
        paymentStatus: o.paymentStatus,
        status: o.status,
      })),
    });
  },
);

/** B2B wholesale sale from admin — same handler as offline; schema forces orderSource=b2b. */
export const createB2bOrder = createOfflineOrder;
