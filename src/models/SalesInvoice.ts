import mongoose, { Schema, Document } from "mongoose";

/**
 * SalesInvoice — admin-only B2B / bulk-order tax invoice generator.
 *
 * Intentionally decoupled from `Order`: these are stand-alone bills the admin
 * creates manually for offline B2B sales. No stock movements, no shipping,
 * no customer-facing surface; purely a billing artefact stored on the server
 * so the same invoice can be re-opened and reprinted from any device.
 *
 * Money fields are stored as plain numbers in INR with up to 2 decimals.
 * Per-row totals are persisted at write time so the admin sees the exact
 * grand total they printed even if business GST defaults change later.
 */

export type SalesInvoiceUnit =
  | "pcs"
  | "mtr"
  | "kg"
  | "gm"
  | "ltr"
  | "set"
  | "box"
  | "pkt"
  | "dozen"
  | "hr"
  | "day"
  | "custom";

export type SalesInvoiceTaxMode = "cgst_sgst" | "igst" | "none";

export interface ISalesInvoiceLine {
  description: string;
  hsn?: string;
  unit: SalesInvoiceUnit;
  customUnit?: string;
  qty: number;
  rate: number;
  discountPct: number;
  gstPct: number;
}

export interface ISalesInvoiceSeller {
  name: string;
  address: string;
  email?: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  state?: string;
}

export interface ISalesInvoiceBuyer {
  name?: string;
  companyName?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  state?: string;
  phone?: string;
  email?: string;
}

export interface ISalesInvoiceMeta {
  invoiceNumber: string;
  /** ISO date (yyyy-mm-dd). Stored as string so the displayed date matches the admin's intent regardless of TZ. */
  invoiceDate: string;
  dueDate?: string;
  poNumber?: string;
  notes?: string;
  terms?: string;
  taxMode: SalesInvoiceTaxMode;
  showHsn: boolean;
  showDiscount: boolean;
  showGstColumn: boolean;
}

export interface ISalesInvoice extends Document {
  invoiceNumber: string;
  invoiceDate: string;
  taxMode: SalesInvoiceTaxMode;
  itemCount: number;
  subTotal: number;
  totalDiscount: number;
  totalGst: number;
  grandTotal: number;
  seller: ISalesInvoiceSeller;
  buyer: ISalesInvoiceBuyer;
  meta: ISalesInvoiceMeta;
  lines: ISalesInvoiceLine[];
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const sellerSchema = new Schema<ISalesInvoiceSeller>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    address: { type: String, required: true, trim: true, maxlength: 500 },
    email: { type: String, trim: true, maxlength: 200, default: "" },
    phone: { type: String, trim: true, maxlength: 30, default: "" },
    gstin: { type: String, trim: true, maxlength: 20, default: "" },
    pan: { type: String, trim: true, maxlength: 20, default: "" },
    state: { type: String, trim: true, maxlength: 80, default: "" },
  },
  { _id: false },
);

const buyerSchema = new Schema<ISalesInvoiceBuyer>(
  {
    name: { type: String, trim: true, maxlength: 200, default: "" },
    companyName: { type: String, trim: true, maxlength: 200, default: "" },
    gstin: { type: String, trim: true, maxlength: 20, default: "" },
    pan: { type: String, trim: true, maxlength: 20, default: "" },
    address: { type: String, trim: true, maxlength: 500, default: "" },
    state: { type: String, trim: true, maxlength: 80, default: "" },
    phone: { type: String, trim: true, maxlength: 30, default: "" },
    email: { type: String, trim: true, maxlength: 200, default: "" },
  },
  { _id: false },
);

const metaSchema = new Schema<ISalesInvoiceMeta>(
  {
    invoiceNumber: { type: String, required: true, trim: true, maxlength: 60 },
    invoiceDate: { type: String, required: true, trim: true, maxlength: 20 },
    dueDate: { type: String, trim: true, maxlength: 20, default: "" },
    poNumber: { type: String, trim: true, maxlength: 80, default: "" },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    terms: { type: String, trim: true, maxlength: 2000, default: "" },
    taxMode: {
      type: String,
      enum: ["cgst_sgst", "igst", "none"],
      required: true,
      default: "cgst_sgst",
    },
    showHsn: { type: Boolean, required: true, default: true },
    showDiscount: { type: Boolean, required: true, default: true },
    showGstColumn: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const lineSchema = new Schema<ISalesInvoiceLine>(
  {
    description: { type: String, required: true, trim: true, maxlength: 500 },
    hsn: { type: String, trim: true, maxlength: 20, default: "" },
    unit: {
      type: String,
      enum: [
        "pcs",
        "mtr",
        "kg",
        "gm",
        "ltr",
        "set",
        "box",
        "pkt",
        "dozen",
        "hr",
        "day",
        "custom",
      ],
      required: true,
      default: "pcs",
    },
    customUnit: { type: String, trim: true, maxlength: 30, default: "" },
    qty: { type: Number, required: true, min: 0, default: 0 },
    rate: { type: Number, required: true, min: 0, default: 0 },
    discountPct: { type: Number, required: true, min: 0, max: 100, default: 0 },
    gstPct: { type: Number, required: true, min: 0, max: 100, default: 0 },
  },
  { _id: false },
);

const salesInvoiceSchema = new Schema<ISalesInvoice>(
  {
    /** Top-level mirror of meta.invoiceNumber so it can be queried + uniquely indexed efficiently. */
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
      index: true,
    },
    invoiceDate: { type: String, required: true, trim: true, maxlength: 20 },
    taxMode: {
      type: String,
      enum: ["cgst_sgst", "igst", "none"],
      required: true,
      default: "cgst_sgst",
    },
    itemCount: { type: Number, required: true, min: 0, default: 0 },
    subTotal: { type: Number, required: true, min: 0, default: 0 },
    totalDiscount: { type: Number, required: true, min: 0, default: 0 },
    totalGst: { type: Number, required: true, min: 0, default: 0 },
    grandTotal: { type: Number, required: true, min: 0, default: 0 },
    seller: { type: sellerSchema, required: true },
    buyer: { type: buyerSchema, required: true },
    meta: { type: metaSchema, required: true },
    lines: { type: [lineSchema], required: true, default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

/** Sort + filter helpers — list views default to newest invoiceDate first. */
salesInvoiceSchema.index({ invoiceDate: -1 });
salesInvoiceSchema.index({ updatedAt: -1 });
/** Per-admin uniqueness on (createdBy + invoiceNumber): different admins can mirror series numbers. */
salesInvoiceSchema.index(
  { createdBy: 1, invoiceNumber: 1 },
  { unique: true, partialFilterExpression: { createdBy: { $exists: true } } },
);

const SalesInvoice =
  (mongoose.models.SalesInvoice as mongoose.Model<ISalesInvoice>) ||
  mongoose.model<ISalesInvoice>("SalesInvoice", salesInvoiceSchema);

export default SalesInvoice;
