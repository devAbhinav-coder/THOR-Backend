import mongoose, { Schema } from "mongoose";

const expoPushTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

expoPushTokenSchema.index({ user: 1, token: 1 }, { unique: true });
expoPushTokenSchema.index({ token: 1 });

const ExpoPushToken =
  mongoose.models.ExpoPushToken ||
  mongoose.model("ExpoPushToken", expoPushTokenSchema);

export default ExpoPushToken;
