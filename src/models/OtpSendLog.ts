import mongoose, { Schema } from "mongoose";

/**
 * Tracks OTP send attempts for per-email rate limiting when Redis is unavailable.
 * Documents auto-expire after 15 minutes (TTL index).
 */
const otpSendLogSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    flow: {
      type: String,
      enum: ["signup", "login", "forgot_password", "generic"],
      default: "generic",
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

otpSendLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 900 });
otpSendLogSchema.index({ email: 1, flow: 1, createdAt: -1 });

const OtpSendLog =
  mongoose.models.OtpSendLog || mongoose.model("OtpSendLog", otpSendLogSchema);
export default OtpSendLog;
