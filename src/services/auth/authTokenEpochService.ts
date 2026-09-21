import User from "../../models/User";
import { invalidateAuthUserSnapshot } from "./authUserSnapshotService";

/** Invalidate all access JWTs carrying an older `ver` claim. */
export async function bumpUserTokenEpoch(userId: string): Promise<number> {
  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { tokenEpoch: 1 } },
    { new: true },
  ).select("tokenEpoch");
  invalidateAuthUserSnapshot(userId);
  return updated?.tokenEpoch ?? 0;
}

export async function getUserTokenEpoch(userId: string): Promise<number> {
  const doc = await User.findById(userId).select("tokenEpoch").lean<{
    tokenEpoch?: number;
  }>();
  return doc?.tokenEpoch ?? 0;
}
