import mongoose, { Schema } from 'mongoose';

const adminAuditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    targetUser: { type: Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    action: { type: String, required: true, trim: true, index: true },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const AdminAuditLog = mongoose.model('AdminAuditLog', adminAuditLogSchema);
export default AdminAuditLog;
