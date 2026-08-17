import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { orderInvoiceNumber } from "../../utils/documentNumbers";

const SELLER = {
  name: "The House of Rani",
  address: "Amrapali Princely State Sector 76, Noida, Uttar Pradesh 201301",
  email: "support@thehouseofrani.com",
  phone: "+91 8340311033",
  gstin: "10CCLPR1131E1Z6",
};

const PAGE = { left: 44, right: 551, width: 507 };
const BORDER = "#9ca3af";
const TEXT = "#1f2937";
const MUTED = "#6b7280";
const LIGHT = "#f3f4f6";

type InvoiceOrder = {
  orderNumber: string;
  createdAt?: Date;
  deliveredAt?: Date;
  invoice?: { generatedAt?: Date };
  paymentMethod?: string;
  paymentStatus?: string;
  razorpayPaymentId?: string;
  subtotal: number;
  discount?: number;
  shippingCharge?: number;
  codFee?: number;
  tax?: number;
  total: number;
  offlineMeta?: { fulfillment?: string };
  shippingAddress?: {
    name?: string;
    house?: string;
    street?: string;
    landmark?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
    phone?: string;
  };
  items: {
    name: string;
    quantity: number;
    price: number;
    variant?: { size?: string; color?: string; sku?: string };
  }[];
};

function resolveLogoPath(): string | null {
  const candidates = [
    path.resolve(__dirname, "../../../../frontend/public/logoNew.png"),
    path.resolve(__dirname, "../../../../frontend/public/logo.png"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function fmtInr(n: number): string {
  const amount = Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `Rs. ${amount}`;
}

function paymentLabel(method?: string): string {
  switch (method) {
    case "cod":
      return "Cash on Delivery";
    case "offline_upi":
      return "Offline — UPI";
    case "offline_cash":
      return "Offline — cash";
    case "razorpay":
      return "Online";
    default:
      return "Online";
  }
}

function formatDate(d?: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function isInPersonOfflineOrder(order: InvoiceOrder): boolean {
  if (order.offlineMeta?.fulfillment === "offline_handover") return true;
  const street = (order.shippingAddress?.street || "").toLowerCase();
  return (
    street.includes("in-person fulfilment") ||
    street.includes("handed over at point of sale")
  );
}

function isPlaceholderAddressField(value?: string): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return (
    v.includes("in-person fulfilment") ||
    v.includes("handed over at point of sale") ||
    v === "fulfilled in person"
  );
}

type PdfDoc = InstanceType<typeof PDFDocument>;

function hLine(doc: PdfDoc, y: number, weight = 0.75): void {
  doc.save().lineWidth(weight).strokeColor(BORDER).moveTo(PAGE.left, y).lineTo(PAGE.right, y).stroke().restore();
}

function labelValue(doc: PdfDoc, x: number, y: number, label: string, value: string, labelW = 100): number {
  doc.fontSize(9).fillColor(TEXT);
  doc.font("Helvetica-Bold").text(`${label}:`, x, y, { width: labelW, continued: false });
  doc.font("Helvetica").text(value, x + labelW, y, { width: PAGE.width / 2 - labelW - 8 });
  return y + 13;
}

function sectionTitle(doc: PdfDoc, x: number, y: number, title: string): number {
  doc.fontSize(8).fillColor(MUTED).font("Helvetica-Bold").text(title.toUpperCase(), x, y, { characterSpacing: 0.6 });
  const lineY = y + 11;
  doc.save().lineWidth(0.5).strokeColor("#d1d5db").moveTo(x, lineY).lineTo(x + 230, lineY).stroke().restore();
  return lineY + 6;
}

function drawAddressColumn(
  doc: PdfDoc,
  x: number,
  y: number,
  title: string,
  name: string,
  bodyLines: string[],
): number {
  let cy = sectionTitle(doc, x, y, title);
  doc.fontSize(9).fillColor(TEXT).font("Helvetica-Bold").text(name, x, cy, { width: 230 });
  cy += 12;
  doc.font("Helvetica").fillColor("#374151").fontSize(9);
  for (const line of bodyLines) {
    doc.text(line, x, cy, { width: 230, lineGap: 1 });
    cy += doc.heightOfString(line, { width: 230 }) + 2;
  }
  return cy;
}

function inPersonBillingLines(phone?: string): string[] {
  return phone ? [`Phone: +91 ${phone}`] : [];
}

function standardAddressLines(addr: NonNullable<InvoiceOrder["shippingAddress"]>): string[] {
  const lines: string[] = [];
  if (addr.house && !isPlaceholderAddressField(addr.house)) lines.push(addr.house);
  if (addr.street && !isPlaceholderAddressField(addr.street)) lines.push(addr.street);
  if (addr.landmark) lines.push(`Landmark: ${addr.landmark}`);
  if (addr.city && addr.state && !isPlaceholderAddressField(addr.city)) {
    lines.push(`${addr.city}, ${addr.state}`);
  }
  if (addr.pincode) {
    lines.push(`${addr.country || "India"} - ${addr.pincode}`);
  }
  if (addr.phone) lines.push(`Phone: +91 ${addr.phone}`);
  return lines;
}

function drawTotalsBox(doc: PdfDoc, x: number, y: number, order: InvoiceOrder): number {
  const boxW = 195;
  let cy = y;
  const row = (label: string, value: string, opts?: { bold?: boolean; green?: boolean; bg?: boolean; borderBottom?: boolean }) => {
    const h = opts?.bold ? 22 : 18;
    if (opts?.bg) {
      doc.save().rect(x, cy, boxW, h).fill(LIGHT).restore();
    }
    doc.fontSize(opts?.bold ? 11 : 9).font(opts?.bold ? "Helvetica-Bold" : "Helvetica");
    doc.fillColor(opts?.green ? "#15803d" : MUTED).text(label, x + 8, cy + 5, { width: 90 });
    doc.fillColor(TEXT).text(value, x + 98, cy + 5, { width: boxW - 106, align: "right" });
    if (opts?.borderBottom !== false) {
      doc.save().lineWidth(0.5).strokeColor(opts?.bold ? BORDER : "#e5e7eb").moveTo(x, cy + h).lineTo(x + boxW, cy + h).stroke().restore();
    }
    cy += h;
  };

  doc.save().rect(x, y, boxW, 0).strokeColor(BORDER).lineWidth(0.75).rect(x, y, boxW, 1).stroke().restore();

  row("Subtotal", fmtInr(order.subtotal));
  if ((order.discount || 0) > 0) {
    row("Discount applied", `- ${fmtInr(order.discount || 0)}`, { green: true });
  }
  row(
    "Shipping Charge",
    (order.shippingCharge || 0) <= 0 ? "Free" : fmtInr(order.shippingCharge || 0),
  );
  if ((order.codFee || 0) > 0) {
    row("COD handling fee", fmtInr(order.codFee || 0));
  }
  row("Tax", fmtInr(order.tax || 0), { borderBottom: true });
  row("Grand Total", fmtInr(order.total), { bold: true, bg: true });

  const sigY = cy + 4;
  doc.save().lineWidth(0.5).strokeColor("#d1d5db").moveTo(x + 8, sigY + 44).lineTo(x + boxW - 8, sigY + 44).stroke().restore();
  doc.fontSize(8).font("Helvetica-Bold").fillColor(TEXT).text("FOR THE HOUSE OF RANI", x, sigY + 8, { width: boxW, align: "center" });
  const stampLogo = resolveLogoPath();
  if (stampLogo) {
    try {
      doc.image(stampLogo, x + boxW / 2 - 18, sigY + 20, { width: 36, height: 18, fit: [36, 18] });
    } catch {
      /* optional stamp */
    }
  }
  doc.fontSize(7).font("Helvetica-Bold").fillColor(MUTED).text("AUTHORIZED SIGNATORY", x, sigY + 48, { width: boxW, align: "center", characterSpacing: 0.8 });

  doc.save().rect(x, y, boxW, sigY + 58 - y).strokeColor(BORDER).lineWidth(0.75).stroke().restore();
  return sigY + 58;
}

/** Full A4 tax invoice PDF — matches admin OrderInvoiceDocument layout. */
export function generateOrderInvoicePdf(order: InvoiceOrder): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE.left, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const invoiceNumber = orderInvoiceNumber(order.orderNumber);
    const invoiceDate = order.invoice?.generatedAt || order.deliveredAt || order.createdAt;
    const inPerson = isInPersonOfflineOrder(order);
    const addr = order.shippingAddress || {};
    const customerName = addr.name || "Customer";

    let y = PAGE.left;

    // ── Header ───────────────────────────────────────────────────────────────
    const logoPath = resolveLogoPath();
    if (logoPath) {
      try {
        doc.image(logoPath, PAGE.left, y, { height: 28 });
      } catch {
        /* logo optional */
      }
    }

    const sellerX = 320;
    doc.fontSize(11).font("Helvetica-Bold").fillColor(TEXT).text(SELLER.name.toUpperCase(), sellerX, y, { width: 231, align: "right" });
    doc.fontSize(8).font("Helvetica").fillColor(TEXT);
    doc.text(SELLER.address, sellerX, doc.y, { width: 231, align: "right", lineGap: 1 });
    doc.text(`Email: ${SELLER.email}`, sellerX, doc.y + 2, { width: 231, align: "right" });
    doc.text(`Ph: ${SELLER.phone}`, sellerX, doc.y + 2, { width: 231, align: "right" });
    doc.font("Helvetica-Bold").text(`GSTIN: ${SELLER.gstin}`, sellerX, doc.y + 2, { width: 231, align: "right" });

    y = Math.max(y + 34, doc.y + 6);
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#374151").text("Tax Invoice", PAGE.left, y);
    doc.fontSize(8).font("Helvetica").fillColor(MUTED).text("Original for Recipient", PAGE.left, y + 18);

    y += 36;
    hLine(doc, y);
    y += 10;

    // ── Order + payment meta ───────────────────────────────────────────────────
    const metaLeftX = PAGE.left;
    const metaRightX = 300;
    const metaStartY = y;
    let leftY = metaStartY;
    leftY = labelValue(doc, metaLeftX, leftY, "Order Number", order.orderNumber);
    leftY = labelValue(doc, metaLeftX, leftY, "Order Date", formatDate(order.createdAt));
    leftY = labelValue(doc, metaLeftX, leftY, "Invoice Number", invoiceNumber);
    leftY = labelValue(doc, metaLeftX, leftY, "Invoice Date", formatDate(invoiceDate));

    let rightY = metaStartY;
    rightY = labelValue(doc, metaRightX, rightY, "Payment Method", paymentLabel(order.paymentMethod));
    rightY = labelValue(
      doc,
      metaRightX,
      rightY,
      "Payment Status",
      (order.paymentStatus || "paid").replace(/^\w/, (c) => c.toUpperCase()),
    );
    if (order.razorpayPaymentId) {
      rightY = labelValue(doc, metaRightX, rightY, "Transaction ID", order.razorpayPaymentId);
    }

    y = Math.max(leftY, rightY) + 6;
    hLine(doc, y);
    y += 12;

    // ── Addresses ────────────────────────────────────────────────────────────
    const billY = y;
    if (inPerson) {
      drawAddressColumn(doc, PAGE.left, billY, "Billed To", customerName, inPersonBillingLines(addr.phone));
      sectionTitle(doc, metaRightX, billY, "Fulfilment");
    } else {
      const shipLines = standardAddressLines(addr);
      drawAddressColumn(doc, PAGE.left, billY, "Billed To", customerName, shipLines);
      drawAddressColumn(doc, metaRightX, billY, "Shipped To", customerName, shipLines);
    }

    y = billY + 88;
    doc.y = y;

    // ── Items table ───────────────────────────────────────────────────────────
    const cols = {
      sn: PAGE.left,
      desc: PAGE.left + 34,
      unit: PAGE.left + 298,
      qty: PAGE.left + 368,
      net: PAGE.left + 418,
    };
    const colWidths = { sn: 32, desc: 260, unit: 66, qty: 46, net: 89 };
    const tableTop = y;

    doc.save().rect(PAGE.left, tableTop, PAGE.width, 20).fill(LIGHT).restore();
    doc.save().rect(PAGE.left, tableTop, PAGE.width, 20).strokeColor(BORDER).lineWidth(0.75).stroke().restore();
    doc.fontSize(7).font("Helvetica-Bold").fillColor(TEXT);
    doc.text("S.NO.", cols.sn + 4, tableTop + 6, { width: colWidths.sn });
    doc.text("DESCRIPTION", cols.desc + 4, tableTop + 6, { width: colWidths.desc });
    doc.text("UNIT PRICE", cols.unit, tableTop + 6, { width: colWidths.unit, align: "right" });
    doc.text("QTY", cols.qty, tableTop + 6, { width: colWidths.qty, align: "center" });
    doc.text("NET AMOUNT", cols.net, tableTop + 6, { width: colWidths.net, align: "right" });

    let rowY = tableTop + 20;
    order.items.forEach((item, i) => {
      const meta = [
        item.variant?.size,
        item.variant?.color,
        item.variant?.sku ? `SKU: ${item.variant.sku}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      doc.fontSize(9);
      const nameH = doc.heightOfString(item.name, { width: colWidths.desc - 8 });
      const metaH = meta ? doc.heightOfString(meta, { width: colWidths.desc - 8 }) + 2 : 0;
      const rowH = Math.max(24, nameH + metaH + 10);

      if (rowY + rowH > doc.page.height - 180) {
        doc.addPage();
        rowY = PAGE.left;
      }

      doc.save().rect(PAGE.left, rowY, PAGE.width, rowH).strokeColor("#d1d5db").lineWidth(0.5).stroke().restore();

      doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(String(i + 1), cols.sn + 4, rowY + 6, { width: colWidths.sn });
      doc.fillColor(TEXT).font("Helvetica-Bold").text(item.name, cols.desc + 4, rowY + 5, { width: colWidths.desc - 8 });
      if (meta) {
        doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(meta, cols.desc + 4, rowY + 5 + nameH, { width: colWidths.desc - 8 });
      }
      doc.fontSize(9).font("Helvetica").fillColor(TEXT);
      doc.text(fmtInr(item.price), cols.unit, rowY + 6, { width: colWidths.unit, align: "right" });
      doc.text(String(item.quantity), cols.qty, rowY + 6, { width: colWidths.qty, align: "center" });
      doc.font("Helvetica-Bold").text(fmtInr(item.price * item.quantity), cols.net, rowY + 6, { width: colWidths.net, align: "right" });

      rowY += rowH;
    });

    doc.save().rect(PAGE.left, tableTop, PAGE.width, rowY - tableTop).strokeColor(BORDER).lineWidth(0.75).stroke().restore();

    // ── Declaration + totals ──────────────────────────────────────────────────
    y = rowY + 14;
    if (y + 160 > doc.page.height - PAGE.left) {
      doc.addPage();
      y = PAGE.left;
    }

    const totalsX = PAGE.right - 195;
    const totalsBottom = drawTotalsBox(doc, totalsX, y, order);

    doc.fontSize(8).font("Helvetica-Bold").fillColor(TEXT).text("DECLARATION:", PAGE.left, y);
    doc.font("Helvetica").fillColor(MUTED).fontSize(8).text(
      "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
      PAGE.left,
      y + 14,
      { width: 280, lineGap: 1 },
    );
    if ((order.shippingCharge || 0) > 0 || (order.codFee || 0) > 0) {
      doc.fontSize(7).text(
        "Note: Shipping and COD handling charges (if shown) are not refundable on approved returns; refunds apply to product value as per our Terms.",
        PAGE.left,
        y + 44,
        { width: 280, lineGap: 1 },
      );
    }

    y = Math.max(totalsBottom, y + 70) + 16;
    hLine(doc, y, 0.5);
    y += 10;

    doc.fontSize(7).font("Helvetica-Bold").fillColor("#374151").text("Return Policy:", PAGE.left, y, { width: PAGE.width, align: "center" });
    doc.font("Helvetica").fillColor(MUTED).text(
      "Please inspect goods immediately upon delivery. Returns are subject to our verified policy terms within 5 days of receipt.",
      PAGE.left,
      y + 10,
      { width: PAGE.width, align: "center", lineGap: 1 },
    );
    doc.fontSize(7).font("Helvetica-Bold").fillColor("#9ca3af").text(
      "THIS IS A COMPUTER GENERATED INVOICE AND DOES NOT REQUIRE A PHYSICAL SIGNATURE.",
      PAGE.left,
      y + 28,
      { width: PAGE.width, align: "center", characterSpacing: 0.4 },
    );

    doc.end();
  });
}

export function invoicePdfFilename(orderNumber: string): string {
  const safe = orderNumber.replace(/[^\w-]+/g, "_");
  return `Invoice_${safe}.pdf`;
}
