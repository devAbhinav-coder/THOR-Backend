import mongoose, { Schema } from "mongoose";

export interface IStoreVisitSession extends mongoose.Document {
  /** Client-generated id (sessionStorage) — one counted visit per session per IST day */
  sessionKey: string;
  /** Asia/Kolkata calendar date YYYY-MM-DD */
  visitDate: string;
  path?: string;
  /** ISO country code from CDN / edge headers (e.g. IN, US) */
  country?: string;
  /** City or state when edge provides it */
  region?: string;
  /** Classified traffic source — Google, Instagram, Direct, etc. */
  referrerSource?: string;
  device?: "mobile" | "tablet" | "desktop";
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  createdAt: Date;
}

const storeVisitSessionSchema = new Schema<IStoreVisitSession>(
  {
    sessionKey: { type: String, required: true, trim: true, maxlength: 64 },
    visitDate: { type: String, required: true, trim: true, maxlength: 10 },
    path: { type: String, trim: true, maxlength: 200 },
    country: { type: String, trim: true, uppercase: true, maxlength: 4 },
    region: { type: String, trim: true, maxlength: 120 },
    referrerSource: { type: String, trim: true, maxlength: 64 },
    device: { type: String, enum: ["mobile", "tablet", "desktop"] },
    utmSource: { type: String, trim: true, maxlength: 120 },
    utmMedium: { type: String, trim: true, maxlength: 120 },
    utmCampaign: { type: String, trim: true, maxlength: 200 },
    utmContent: { type: String, trim: true, maxlength: 200 },
    utmTerm: { type: String, trim: true, maxlength: 200 },
    fbclid: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

storeVisitSessionSchema.index({ sessionKey: 1, visitDate: 1 }, { unique: true });
storeVisitSessionSchema.index({ visitDate: 1 });
storeVisitSessionSchema.index({ createdAt: -1 });
storeVisitSessionSchema.index({ country: 1, visitDate: 1 });
storeVisitSessionSchema.index({ referrerSource: 1, visitDate: 1 });
storeVisitSessionSchema.index({ utmCampaign: 1, visitDate: 1 });

const StoreVisitSession =
  mongoose.models.StoreVisitSession ||
  mongoose.model<IStoreVisitSession>("StoreVisitSession", storeVisitSessionSchema);

export default StoreVisitSession;
