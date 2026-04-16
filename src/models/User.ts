import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import { IUser } from '../types';

/** True only when all shipping fields + formats are valid (used to drop partial/legacy junk). */
function isCompletePlainAddress(o: Record<string, unknown>): boolean {
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const phone = typeof o.phone === 'string' ? o.phone.replace(/\s/g, '') : '';
  const house = typeof o.house === 'string' ? o.house.trim() : '';
  const street = typeof o.street === 'string' ? o.street.trim() : '';
  const city = typeof o.city === 'string' ? o.city.trim() : '';
  const state = typeof o.state === 'string' ? o.state.trim() : '';
  const pincode = typeof o.pincode === 'string' ? o.pincode.trim() : '';
  if (!name || !phone || !street || !city || !state || !pincode) return false;
  if (!/^(\+91)?[6-9]\d{9}$/.test(phone)) return false;
  if (!/^\d{6}$/.test(pincode)) return false;
  return true;
}

/**
 * Address fields are not individually `required` so empty `{}` never fails validation
 * (Mongoose validates subdocuments BEFORE parent `pre('validate')`).
 * Partial addresses must NOT fail save — parent strips them; only complete rows are kept.
 */
const addressSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 80 },
    phone: { type: String, trim: true },
    label: { type: String, default: 'Home' },
    /** House / flat / building, kept separate from street. */
    house: { type: String, trim: true },
    street: { type: String, trim: true },
    /** Nearby landmark to help couriers (optional). */
    landmark: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, default: 'India' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

addressSchema.pre('validate', function (next) {
  const a = this as mongoose.Document & {
    name?: string;
    phone?: string;
    house?: string;
    landmark?: string;
    street?: string;
    city?: string;
    state?: string;
    pincode?: string;
  };
  const name = a.name?.trim();
  const phone = (a.phone || '').replace(/\s/g, '');
  const house = a.house?.trim();
  const landmark = a.landmark?.trim();
  const street = a.street?.trim();
  const city = a.city?.trim();
  const state = a.state?.trim();
  const pincode = a.pincode?.trim();
  const hasAny = Boolean(
    name || phone || house || landmark || street || city || state || pincode
  );
  if (!hasAny) {
    return next();
  }
  const complete = Boolean(name && phone && street && city && state && pincode);
  if (!complete) {
    // Partial row (e.g. only name) — do not block User save; parent will remove
    return next();
  }
  if (!/^(\+91)?[6-9]\d{9}$/.test(phone)) {
    this.invalidate('phone', 'Please enter a valid Indian phone number');
    return next();
  }
  if (!pincode || !/^\d{6}$/.test(pincode)) {
    this.invalidate('pincode', 'Invalid pincode');
    return next();
  }
  next();
});

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
      select: false,
    },
    welcomeEmailAt: {
      type: Date,
      required: false,
      select: false,
    },
    emailVerified: {
      type: Boolean,
      default: true,
    },
    phone: {
      type: String,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid Indian phone number'],
    },
    avatar: String,
    adminNote: { type: String, maxlength: 1000, default: '' },
    addresses: {
      type: [addressSchema],
      default: [],
    },
    isActive: { type: Boolean, default: true },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret['password'];
        delete ret['googleId'];
        delete ret['welcomeEmailAt'];
        delete ret['passwordResetToken'];
        delete ret['passwordResetExpires'];
        delete ret['__v'];
        return ret;
      },
    },
  }
);

/** Keep only complete valid addresses — drops {}, partial, and bad legacy rows */
userSchema.pre('validate', function (next) {
  const raw = this.get('addresses') as unknown;
  if (!Array.isArray(raw)) {
    return next();
  }
  const kept = raw.filter((addr: unknown) => {
    if (!addr || typeof addr !== 'object') return false;
    return isCompletePlainAddress(addr as Record<string, unknown>);
  });
  this.set('addresses', kept);
  next();
});

userSchema.pre<IUser>('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) {
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp: number): boolean {
  if (this.passwordChangedAt) {
    const changedTimestamp = Math.floor(this.passwordChangedAt.getTime() / 1000);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

const User = mongoose.model<IUser>('User', userSchema);
export default User;
