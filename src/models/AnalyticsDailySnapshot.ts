import { Schema, model, Document } from 'mongoose';

export interface IAnalyticsDailySnapshot extends Document {
  date: string;
  revenue: number;
  orders: number;
  paidOrders: number;
  cancelledOrders: number;
  newUsers: number;
  avgOrderValue: number;
  siteVisits: number;
  couponDiscount: number;
  refundedAmount: number;
  computedAt: Date;
}

const analyticsDailySnapshotSchema = new Schema<IAnalyticsDailySnapshot>(
  {
    date: { type: String, required: true, unique: true },
    revenue: { type: Number, default: 0 },
    orders: { type: Number, default: 0 },
    paidOrders: { type: Number, default: 0 },
    cancelledOrders: { type: Number, default: 0 },
    newUsers: { type: Number, default: 0 },
    avgOrderValue: { type: Number, default: 0 },
    siteVisits: { type: Number, default: 0 },
    couponDiscount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    computedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const AnalyticsDailySnapshot = model<IAnalyticsDailySnapshot>(
  'AnalyticsDailySnapshot',
  analyticsDailySnapshotSchema,
);
export default AnalyticsDailySnapshot;
