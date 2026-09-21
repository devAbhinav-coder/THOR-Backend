import crypto from "crypto";
import User from "../../models/User";
import { coalesceInFlight } from "../../types/utils/inFlightCoalesce";
import { getCache, setCache, deleteCache } from "../cacheService";
import { recordPlatformMetric } from "../observability/platformMetricsService";

const SNAPSHOT_TTL_SEC = Number(process.env.AUTH_USER_CACHE_TTL_SEC || 60);

export type AuthUserSnapshot = {
  _id: string;
  name: string;
  email: string;
  role: "user" | "admin" | "staff";
  adminPermissions?: string[];
  isActive: boolean;
  phone?: string;
  avatar?: string;
  adminNote?: string;
  addresses: unknown[];
  emailVerified?: boolean;
  whatsappMarketingOptIn?: boolean;
  offlineLead?: boolean;
  adminTwoFactorEnabled?: boolean;
  passwordChangedAt?: string;
  tokenEpoch: number;
  createdAt?: string;
  updatedAt?: string;
};

function snapshotCacheKey(userId: string): string {
  return `auth:user:${userId}`;
}

export function invalidateAuthUserSnapshot(userId: string): void {
  void deleteCache(snapshotCacheKey(userId));
}

async function loadSnapshotFromDb(userId: string): Promise<AuthUserSnapshot | null> {
  const doc = await User.findById(userId)
    .select("-password -googleId -welcomeEmailAt -passwordResetToken -passwordResetExpires -adminTwoFactorSecret -adminTwoFactorBackupCodes")
    .lean<Record<string, unknown> | null>();
  if (!doc) return null;

  return {
    _id: String(doc._id),
    name: String(doc.name ?? ""),
    email: String(doc.email ?? ""),
    role: (doc.role as "user" | "admin" | "staff") || "user",
    adminPermissions: Array.isArray(doc.adminPermissions)
      ? (doc.adminPermissions as string[])
      : [],
    isActive: doc.isActive !== false,
    phone: doc.phone as string | undefined,
    avatar: doc.avatar as string | undefined,
    adminNote: doc.adminNote as string | undefined,
    addresses: (doc.addresses as unknown[]) ?? [],
    emailVerified: doc.emailVerified as boolean | undefined,
    whatsappMarketingOptIn: doc.whatsappMarketingOptIn as boolean | undefined,
    offlineLead: doc.offlineLead as boolean | undefined,
    adminTwoFactorEnabled: doc.adminTwoFactorEnabled as boolean | undefined,
    passwordChangedAt:
      doc.passwordChangedAt ?
        new Date(doc.passwordChangedAt as Date).toISOString()
      : undefined,
    tokenEpoch: Number(doc.tokenEpoch ?? 0),
    createdAt:
      doc.createdAt ?
        new Date(doc.createdAt as Date).toISOString()
      : undefined,
    updatedAt:
      doc.updatedAt ?
        new Date(doc.updatedAt as Date).toISOString()
      : undefined,
  };
}

export async function getAuthUserSnapshot(
  userId: string,
): Promise<AuthUserSnapshot | null> {
  const key = snapshotCacheKey(userId);
  const cached = await getCache<AuthUserSnapshot>(key);
  if (cached && cached._id === userId) {
    recordPlatformMetric("auth.user_cache.hit", { userId });
    return cached;
  }

  return coalesceInFlight(`auth:user:load:${userId}`, async () => {
    const again = await getCache<AuthUserSnapshot>(key);
    if (again && again._id === userId) {
      recordPlatformMetric("auth.user_cache.hit", { userId });
      return again;
    }
    recordPlatformMetric("auth.user_cache.miss", { userId });
    const fresh = await loadSnapshotFromDb(userId);
    if (fresh) {
      await setCache(key, fresh, SNAPSHOT_TTL_SEC).catch(() => {});
    }
    return fresh;
  });
}

/** Stable hash for coalesce keys in cart revalidation. */
export function hashIdList(ids: string[]): string {
  const sorted = [...ids].sort();
  return crypto.createHash("md5").update(sorted.join(",")).digest("hex");
}
