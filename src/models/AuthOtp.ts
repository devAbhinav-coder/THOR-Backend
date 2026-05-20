import mongoose, { Schema } from 'mongoose';

/** Stored in MongoDB (`purpose`). API uses `forgot_password` which maps to `password_reset`. */
export type AuthOtpPurpose = 'signup' | 'login' | 'password_reset';

const signupPayloadSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String },
    /**
     * Plain password stored for max 10 minutes (TTL index auto-deletes the document).
     * The User model's pre('save') hook hashes it at account creation time.
     * The TTL index on expiresAt ensures this document is removed by MongoDB automatically.
     */
    password: { type: String, required: true },
  },
  { _id: false }
);

const authOtpSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    purpose: {
      type: String,
      enum: ['signup', 'login', 'password_reset'],
      required: true,
    },
    /** bcrypt hash of the 6-digit code (never store plaintext). */
    codeHash: { type: String, required: true },
    /** TTL index — MongoDB auto-deletes expired documents. */
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    /** Last time a code was emailed — used for 60s resend cooldown. */
    lastSentAt: { type: Date },
    /** Set when OTP is successfully verified (atomic consumption). */
    consumedAt: { type: Date },
    /** Short-lived token issued after forgot-password OTP verify (hashed). */
    resetTokenHash: { type: String, index: true },
    resetTokenExpiresAt: { type: Date },
    signupPayload: { type: signupPayloadSchema, required: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret['signupPayload'];
        delete ret['codeHash'];
        return ret;
      },
    },
  }
);

authOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });
// TTL index: MongoDB removes expired OTP documents automatically (max 10 min window)
authOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AuthOtp = mongoose.model('AuthOtp', authOtpSchema);
export default AuthOtp;
