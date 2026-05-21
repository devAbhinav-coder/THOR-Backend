import mongoose, { Schema, Document, Types } from 'mongoose';

export const OPERATING_EXPENSE_CATEGORIES = [
  'shipping_outbound',
  'packing',
  'ads',
  'miscellaneous',
  'rent',
  'utilities',
  'salaries',
  'other',
] as const;

export type OperatingExpenseCategory = (typeof OPERATING_EXPENSE_CATEGORIES)[number];

export type OperatingExpenseStatus = 'active' | 'voided';

export interface IOperatingExpense extends Document {
  _id: Types.ObjectId;
  status: OperatingExpenseStatus;
  voidedAt?: Date;
  voidedBy?: Types.ObjectId;
  category: OperatingExpenseCategory;
  title: string;
  amount: number;
  expenseDate: Date;
  notes?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const operatingExpenseSchema = new Schema<IOperatingExpense>(
  {
    status: { type: String, enum: ['active', 'voided'], default: 'active' },
    voidedAt: Date,
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    category: {
      type: String,
      enum: OPERATING_EXPENSE_CATEGORIES,
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    amount: { type: Number, required: true, min: 0 },
    expenseDate: { type: Date, required: true },
    notes: { type: String, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

operatingExpenseSchema.index({ expenseDate: -1 });
operatingExpenseSchema.index({ category: 1, expenseDate: -1 });
operatingExpenseSchema.index({ status: 1, expenseDate: -1 });

const OperatingExpense = mongoose.model<IOperatingExpense>(
  'OperatingExpense',
  operatingExpenseSchema,
);
export default OperatingExpense;
