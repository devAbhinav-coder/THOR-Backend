import mongoose, { Schema, Document, Types } from 'mongoose';

export type StockChangeReason =
  | 'sale'
  | 'sale_return'
  | 'purchase'
  | 'damage'
  | 'manual_correction'
  | 'opening_stock';

export interface IStockLedger extends Document {
  _id: Types.ObjectId;
  /** Product this movement belongs to. */
  product: Types.ObjectId;
  /** Variant SKU. */
  sku: string;
  /** Snapshot of product name at time of event. */
  productName: string;
  /** Human-readable variant label e.g. "S / Red". */
  variantLabel?: string;
  /**
   * Signed quantity change — positive = stock in, negative = stock out.
   * e.g. -2 for a sale of 2 units, +10 for a purchase receipt.
   */
  delta: number;
  /** Stock level AFTER this movement (denormalised for easy charting). */
  stockAfter: number;
  reason: StockChangeReason;
  /** Order ID, purchase invoice ID, or any reference doc. */
  referenceId?: Types.ObjectId | string;
  referenceType?: 'order' | 'purchase_invoice' | 'manual';
  /** Admin user who triggered this (may be null for system-triggered events). */
  actor?: Types.ObjectId;
  note?: string;
  createdAt: Date;
}

const stockLedgerSchema = new Schema<IStockLedger>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      // Covered by compound index { product, sku, createdAt } below — no standalone index needed
    },
    sku: {
      type: String,
      required: true,
      // Standalone sku index removed — sku-only queries are rare; compound index covers product+sku lookups
    },
    productName: { type: String, required: true },
    variantLabel: String,
    delta: { type: Number, required: true },
    stockAfter: { type: Number, required: true, default: 0 },
    reason: {
      type: String,
      enum: ['sale', 'sale_return', 'purchase', 'damage', 'manual_correction', 'opening_stock'],
      required: true,
    },
    referenceId: Schema.Types.Mixed,
    referenceType: { type: String, enum: ['order', 'purchase_invoice', 'manual'] },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockLedgerSchema.index({ product: 1, sku: 1, createdAt: -1 });
stockLedgerSchema.index({ reason: 1, createdAt: -1 });
stockLedgerSchema.index({ createdAt: -1 });

const StockLedger = mongoose.model<IStockLedger>('StockLedger', stockLedgerSchema);
export default StockLedger;
