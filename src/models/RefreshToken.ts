import mongoose, { Schema } from 'mongoose';

const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    /** Rotation family — reuse of a revoked token revokes entire family. */
    familyId: { type: String, index: true },
    replacedByTokenHash: { type: String },
    deviceLabel: { type: String, maxlength: 80 },
    userAgent: { type: String, maxlength: 512 },
    ip: { type: String, maxlength: 64 },
    lastUsedAt: { type: Date },
    /** True when admin completed TOTP at login — required for admin API when 2FA enabled. */
    admin2faVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ user: 1, revokedAt: 1, createdAt: -1 });

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
export default RefreshToken;
