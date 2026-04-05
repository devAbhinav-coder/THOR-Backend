import mongoose, { Schema } from 'mongoose';

/** Stored in MongoDB (`purpose`). API uses `forgot_password` which maps to `password_reset`. */
export type AuthOtpPurpose = 'signup' | 'login' | 'password_reset';

const signupPayloadSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String },
    /** Plain password only until OTP verified (short TTL) */
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
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    /** Last time a code was emailed — used for 60s resend cooldown. */
    lastSentAt: { type: Date },
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

const AuthOtp = mongoose.model('AuthOtp', authOtpSchema);
export default AuthOtp;
