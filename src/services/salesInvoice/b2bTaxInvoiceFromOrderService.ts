import mongoose from "mongoose";
import Order from "../../models/Order";
import SalesInvoice, {
  type ISalesInvoice,
  type ISalesInvoiceLine,
} from "../../models/SalesInvoice";
import type { IAddress, IOrderItem } from "../../types";
import AppError from "../../types/utils/AppError";
import {
  suggestB2bTaxInvoiceNumber,
} from "../../utils/documentNumbers";
import {
  computeTotals,
  DEFAULT_SALES_INVOICE_SELLER,
  DEFAULT_SALES_INVOICE_TERMS,
  todayIsoDate,
} from "../../utils/salesInvoiceHelpers";

type PopulatedUser = {
  name?: string;
  email?: string;
  phone?: string;
};

type PopulatedProduct = {
  _id: mongoose.Types.ObjectId;
  hsnCode?: string;
};

function formatShippingAddress(addr: IAddress): string {
  const parts = [
    addr.house,
    addr.street,
    addr.landmark,
    [addr.city, addr.state, addr.pincode].filter(Boolean).join(", "),
    addr.country,
  ].filter((p) => typeof p === "string" && p.trim().length > 0);
  return parts.join(", ");
}

function lineDescription(item: IOrderItem): string {
  const variantParts = [item.variant?.color, item.variant?.size].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  if (variantParts.length === 0) return item.name;
  return `${item.name} — ${variantParts.join(" / ")}`;
}

function hsnForItem(
  item: IOrderItem,
  product?: PopulatedProduct | null,
): string {
  const fromProduct =
    product && typeof product.hsnCode === "string" ?
      product.hsnCode.trim()
    : "";
  return fromProduct.slice(0, 20);
}

function buildLinesFromOrder(
  items: IOrderItem[],
  productById: Map<string, PopulatedProduct>,
): ISalesInvoiceLine[] {
  return items.map((item) => {
    const productId =
      item.product instanceof mongoose.Types.ObjectId ?
        String(item.product)
      : typeof item.product === "object" && item.product !== null ?
        String((item.product as PopulatedProduct)._id)
      : String(item.product);
    const product = productById.get(productId);
    return {
      description: lineDescription(item),
      hsn: hsnForItem(item, product),
      unit: "pcs" as const,
      customUnit: "",
      qty: Math.max(0, item.quantity),
      rate: Math.max(0, item.price),
      discountPct: 0,
      gstPct: 0,
    };
  });
}

export function salesInvoiceToClientShape(doc: ISalesInvoice) {
  return {
    id: String(doc._id),
    updatedAt: doc.updatedAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    invoiceNumber: doc.invoiceNumber,
    invoiceDate: doc.invoiceDate,
    taxMode: doc.taxMode,
    itemCount: doc.itemCount,
    grandTotal: doc.grandTotal,
    subTotal: doc.subTotal,
    totalDiscount: doc.totalDiscount,
    totalGst: doc.totalGst,
    seller: doc.seller,
    buyer: doc.buyer,
    meta: doc.meta,
    lines: doc.lines,
    orderId: doc.orderId ? String(doc.orderId) : undefined,
    orderNumber: doc.orderNumber || undefined,
  };
}

export async function getTaxInvoiceForOrder(orderId: string) {
  const invoice = await SalesInvoice.findOne({
    orderId: new mongoose.Types.ObjectId(orderId),
  });
  if (!invoice) return null;
  return salesInvoiceToClientShape(invoice);
}

export async function createTaxInvoiceFromB2bOrder(
  orderId: string,
  adminId?: mongoose.Types.ObjectId,
): Promise<ISalesInvoice> {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError("Invalid order id.", 400);
  }

  const order = await Order.findById(orderId)
    .populate("user", "name email phone")
    .populate("items.product", "hsnCode");

  if (!order) throw new AppError("Order not found.", 404);
  if (order.offlineMeta?.source !== "b2b") {
    throw new AppError("Tax invoices can only be created from B2B orders.", 400);
  }
  if (!order.items?.length) {
    throw new AppError("Order has no line items.", 400);
  }

  const existing = await SalesInvoice.findOne({ orderId: order._id }).select(
    "_id invoiceNumber",
  );
  if (existing) {
    throw new AppError(
      `A tax invoice already exists for this order (${existing.invoiceNumber}).`,
      409,
    );
  }

  const productById = new Map<string, PopulatedProduct>();
  for (const item of order.items) {
    const raw = item.product as unknown;
    if (raw && typeof raw === "object" && "_id" in (raw as object)) {
      const p = raw as PopulatedProduct;
      productById.set(String(p._id), p);
    }
  }

  const lines = buildLinesFromOrder(order.items, productById);
  if (lines.every((l) => !l.description.trim() && l.qty * l.rate === 0)) {
    throw new AppError("Order has no billable line items.", 400);
  }

  const user =
    order.user && typeof order.user === "object" ?
      (order.user as PopulatedUser)
    : undefined;
  const ship = order.shippingAddress;
  const b2b = order.b2bMeta;

  const buyer: ISalesInvoice["buyer"] = {
    name: (ship?.name || user?.name || "").trim(),
    companyName: (b2b?.companyName || "").trim(),
    gstin: (b2b?.gstin || "").trim().toUpperCase(),
    pan: "",
    address: ship ? formatShippingAddress(ship) : "",
    state: (ship?.state || "").trim(),
    phone: (ship?.phone || user?.phone || "").trim(),
    email: (user?.email || "").trim(),
  };

  const invoiceNumber = suggestB2bTaxInvoiceNumber();
  const invoiceDate = todayIsoDate();
  const meta: ISalesInvoice["meta"] = {
    invoiceNumber,
    invoiceDate,
    dueDate: "",
    poNumber: (b2b?.poNumber || "").trim(),
    notes: `Generated from B2B order ${order.orderNumber}.`,
    terms: DEFAULT_SALES_INVOICE_TERMS,
    taxMode: "cgst_sgst",
    showHsn: true,
    showDiscount: true,
    showGstColumn: true,
  };

  const totals = computeTotals(lines, meta.taxMode);

  let created: ISalesInvoice;
  try {
    created = await SalesInvoice.create({
      invoiceNumber,
      invoiceDate,
      taxMode: meta.taxMode,
      itemCount: lines.length,
      ...totals,
      seller: DEFAULT_SALES_INVOICE_SELLER,
      buyer,
      meta,
      lines,
      orderId: order._id,
      orderNumber: order.orderNumber,
      createdBy: adminId,
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 11000) {
      throw new AppError(
        `Invoice number "${invoiceNumber}" already exists. Try again.`,
        409,
      );
    }
    throw err;
  }

  order.taxSalesInvoiceId = created._id as mongoose.Types.ObjectId;
  await order.save({ validateBeforeSave: false });

  return created;
}
