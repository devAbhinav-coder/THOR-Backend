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
import { onOrderMarkedDelivered } from "../services/coupon/couponUserStatsService";
import { emailTemplates } from "../services/emailService";
import { enqueueEmail } from "../queues/emailQueue";
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

type LineIn =
  | {
      type: "catalog";
      productId: string;
      variantSku: string;
      quantity: number;
      unitPrice?: number;
    }
  | {
      type: "manual";
      categoryId?: string;
      title?: string;
      quantity: number;
      unitPrice: number;
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
      orderSource: "stall" | "personal_contact";
      fulfillment: "delhivery" | "offline_handover";
      paymentMethod: "offline_upi" | "offline_cash";
      shippingAddress?: AddrIn;
      lineItems: LineIn[];
      notes?: string;
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
    } = body;

    const phone10 = normalizeInPhone(String(phone || ""));
    if (!/^[6-9]\d{9}$/.test(phone10)) {
      return next(
        new AppError("Enter a valid 10-digit Indian mobile number.", 400),
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
        let lineImage = offlineManualProduct.images[0]!.url;

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
          if (cimg) lineImage = cimg;
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
        orderItems.push({
          product: offlinePid,
          name: lineName,
          slug: "offline-manual-item",
          image: lineImage,
          variant: { sku: OFFLINE_MANUAL_VARIANT_SKU },
          quantity: qty,
          price: unit,
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

    const emailNorm = String(email || "")
      .trim()
      .toLowerCase();
    let user = await User.findOne({ email: emailNorm });
    if (!user) {
      try {
        user = await User.create({
          name: customerName.trim().slice(0, 50),
          email: emailNorm,
          password: randomStrongPassword(),
          phone: phone10,
          offlineLead: true,
        });
      } catch (err: unknown) {
        const code = (err as { code?: number })?.code;
        if (code === 11000) {
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
    user.phone = phone10;
    await user.save();

    const isOfflineMarketingLead = Boolean(
      (user as { offlineLead?: boolean }).offlineLead,
    );
    if (!isOfflineMarketingLead) {
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
          phone: phone10,
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

        // Audit: Log the stock movement
        await logStockMovement(op.productId, op.sku, -op.qty, {
          reason: "sale",
          note: "Offline sale recorded by admin",
        }).catch((err) => console.error("Stock ledger fail (sale):", err));
      }

      const adminId = req.user?._id as mongoose.Types.ObjectId | undefined;

      const order = await Order.create({
        user: user._id,
        items: orderItems,
        shippingAddress: shipAddr,
        status: isHandover ? "delivered" : "confirmed",
        paymentStatus: "paid",
        paymentMethod,
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
        ...(isHandover ?
          {
            deliveredAt: new Date(),
            invoice: { isGenerated: true, generatedAt: new Date() },
          }
        : {}),
      });

      if (isHandover) {
        void onOrderMarkedDelivered(String(user._id)).catch(() => {});
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

      const userTemplate = emailTemplates.offlineOrderThankYou(
        user.name,
        order.orderNumber,
        order.total,
        {
          orderId: String(order._id),
          fulfillment,
          paymentLabel,
          items: emailLineItems,
        },
      );
      await enqueueEmail({
        to: user.email,
        subject: userTemplate.subject,
        html: userTemplate.html,
      });

      const adminTemplate = emailTemplates.adminNewOrder(
        order.orderNumber,
        order.total,
        user.name,
        user.email,
      );
      await notifyAdminsEmail(adminTemplate.subject, adminTemplate.html);

      await notifyAdmins(
        "Offline order recorded",
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

      if (isOfflineMarketingLead) {
        await upsertOfflineCustomerRecord({
          email: emailNorm,
          phone: phone10,
          name: customerName.trim().slice(0, 50),
        });
      }

      sendSuccess(res, { order: order.toJSON() }, "Offline order created", 201);
    } catch (err) {
      for (const d of decremented.reverse()) {
        await incrementVariantStock(d.productId, d.sku, d.qty).catch(() => {});
        // Audit: Log the rollback
        await logStockMovement(d.productId, d.sku, d.qty, {
          reason: "manual_correction",
          note: "Offline order creation rollback",
        }).catch(() => {});
      }
      throw err;
    }
  },
);
