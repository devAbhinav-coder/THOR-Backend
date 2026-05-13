import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPurchaseInvoiceLineItem {
  /** Optional link to a catalog product. */
  product?: Types.ObjectId;
  productName: string;
  sku: string;
  /** Variant label, e.g. "S / Red". */
  variantLabel?: string;
  quantity: number;
  /** Per-unit purchase price (ex-tax). */
  unitCost: number;
  /** HSN/SAC code for GST filing. */
  hsn?: string;
  /** GST rate in % (e.g. 5, 12, 18). */
  gstRate: number;
  /** Calculated: quantity × unitCost */
  taxableAmount: number;
  /** CGST amount (intra-state, 50% of total GST). */
  cgst: number;
  /** SGST amount (intra-state, 50% of total GST). */
  sgst: number;
  /** IGST amount (inter-state, 100% of total GST). */
  igst: number;
  lineTotal: number;
}

export interface IPurchaseInvoice extends Document {
  _id: Types.ObjectId;
  invoiceNumber: string;
  supplierName: string;
  supplierGstin?: string;
  /** Whether the supply is intra-state (CGST+SGST) or inter-state (IGST). */
  supplyType: 'intra' | 'inter';
  invoiceDate: Date;
  lineItems: IPurchaseInvoiceLineItem[];
  /** Sum of all taxableAmount fields. */
  totalTaxable: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  grandTotal: number;
  paymentStatus: 'unpaid' | 'paid' | 'partial';
  paidAmount: number;
  notes?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const lineItemSchema = new Schema<IPurchaseInvoiceLineItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, required: true },
    sku: { type: String, required: true },
    variantLabel: String,
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
    hsn: { type: String, maxlength: 20 },
    gstRate: { type: Number, required: true, min: 0, max: 100, default: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const purchaseInvoiceSchema = new Schema<IPurchaseInvoice>(
  {
    invoiceNumber: { type: String, required: true, trim: true },
    supplierName: { type: String, required: true, trim: true, maxlength: 200 },
    supplierGstin: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 15,
      validate: {
        validator: (v: string) => !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v),
        message: 'Invalid GSTIN format',
      },
    },
    supplyType: { type: String, enum: ['intra', 'inter'], default: 'intra' },
    invoiceDate: { type: Date, required: true },
    lineItems: { type: [lineItemSchema], validate: { validator: (v: unknown[]) => v.length > 0, message: 'At least one line item required' } },
    totalTaxable: { type: Number, default: 0 },
    totalCgst: { type: Number, default: 0 },
    totalSgst: { type: Number, default: 0 },
    totalIgst: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['unpaid', 'paid', 'partial'], default: 'unpaid' },
    paidAmount: { type: Number, default: 0 },
    notes: { type: String, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

purchaseInvoiceSchema.index({ invoiceDate: -1 });
purchaseInvoiceSchema.index({ supplierGstin: 1 });
purchaseInvoiceSchema.index({ createdAt: -1 });

const PurchaseInvoice = mongoose.model<IPurchaseInvoice>('PurchaseInvoice', purchaseInvoiceSchema);
export default PurchaseInvoice;
