import Product from "../../models/Product";
import Blog from "../../models/Blog";
import User from "../../models/User";
import Order from "../../models/Order";
import logger from "../../types/utils/logger";
import { emailTemplates } from "../emailService";
import { enqueueEmail } from "../../queues/emailQueue";
import { resolveReturn } from "../adminReturnService";
import { syncProductEmbedding, syncBlogEmbedding } from "../ai/vectorIndexService";
import { cloudinaryInstance } from "../cloudinary";

/** Re-embed products/blogs updated since last embedding sync. */
export async function runVectorEmbeddingRefreshJob(): Promise<number> {
  const staleDays = Number(process.env.EMBEDDING_STALE_DAYS || 7);
  const batch = Number(process.env.EMBEDDING_REFRESH_BATCH || 200);
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

  const [products, blogs] = await Promise.all([
    Product.find({
      isActive: true,
      updatedAt: { $gte: cutoff },
      contentEmbedding: { $exists: true, $not: { $size: 0 } },
    })
      .select("_id")
      .limit(batch)
      .lean(),
    Blog.find({
      isPublished: true,
      updatedAt: { $gte: cutoff },
      contentEmbedding: { $exists: true, $not: { $size: 0 } },
    })
      .select("_id")
      .limit(Math.floor(batch / 4))
      .lean(),
  ]);

  let n = 0;
  for (const p of products) {
    await syncProductEmbedding(String(p._id));
    n += 1;
  }
  for (const b of blogs) {
    await syncBlogEmbedding(String(b._id));
    n += 1;
  }
  return n;
}

/** Users inactive 30+ days → re-engagement email. */
export async function runInactiveUserReengagementJob(): Promise<number> {
  const inactiveDays = Number(process.env.REENGAGE_INACTIVE_DAYS || 30);
  const batch = Number(process.env.REENGAGE_BATCH || 100);
  const cooldownDays = Number(process.env.REENGAGE_COOLDOWN_DAYS || 30);
  const inactiveBefore = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
  const cooldownBefore = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);

  const users = await User.find({
    role: "user",
    isActive: true,
    emailVerified: true,
    email: { $exists: true, $nin: [null, ""] },
    $or: [
      { lastActiveAt: { $lt: inactiveBefore } },
      { lastActiveAt: null, updatedAt: { $lt: inactiveBefore } },
    ],
    $and: [
      {
        $or: [
          { reengagementEmailAt: null },
          { reengagementEmailAt: { $lt: cooldownBefore } },
        ],
      },
    ],
  })
    .select("name email")
    .limit(batch)
    .lean()
    .maxTimeMS(10000);

  let sent = 0;
  for (const user of users) {
    if (!user.email) continue;
    const tpl = emailTemplates.reengagement(user.name || "there");
    await enqueueEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
    });
    await User.updateOne(
      { _id: user._id },
      { $set: { reengagementEmailAt: new Date() } },
    );
    sent += 1;
  }
  return sent;
}

/** Auto-approve eligible return requests (strict rules; off by default in prod). */
export async function runReturnAutoApproveJob(): Promise<number> {
  const maxAmount = Number(process.env.RETURN_AUTO_APPROVE_MAX_AMOUNT || 5000);
  const maxAgeHours = Number(process.env.RETURN_AUTO_APPROVE_AFTER_HOURS || 48);
  const batch = Number(process.env.RETURN_AUTO_APPROVE_BATCH || 25);
  const requestedBefore = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const allowedReasons = (process.env.RETURN_AUTO_APPROVE_REASONS || "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);

  if (allowedReasons.length === 0) {
    logger.debug({
      msg: "return_auto_approve_skipped",
      reason: "RETURN_AUTO_APPROVE_REASONS empty — configure whitelist to enable",
    });
    return 0;
  }

  const query: Record<string, unknown> = {
    returnStatus: "requested",
    total: { $lte: maxAmount },
    "returnRequest.requestedAt": { $lte: requestedBefore },
    paymentStatus: "paid",
    paymentMethod: { $nin: ["cod"] },
    $or: [{ offlineMeta: { $exists: false } }, { offlineMeta: null }],
    "returnRequest.reason": { $in: allowedReasons },
  };

  const orders = await Order.find(query)
    .limit(batch)
    .lean()
    .maxTimeMS(8000);

  let approved = 0;
  for (const row of orders) {
    try {
      const mockReq = { user: { _id: null, role: "admin" } } as never;
      await resolveReturn(
        mockReq,
        String(row._id),
        "approve",
        "Auto-approved by scheduled job",
      );
      approved += 1;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "approve failed";
      logger.warn({
        msg: "return_auto_approve_skip",
        orderId: String(row._id),
        error: message,
      });
    }
  }
  return approved;
}

/** Warm Cloudinary optimized transforms for recent product images. */
export async function runBulkImageOptimizerJob(): Promise<number> {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY
  ) {
    return 0;
  }

  const batch = Number(process.env.IMAGE_OPTIMIZE_BATCH || 50);
  const days = Number(process.env.IMAGE_OPTIMIZE_DAYS || 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const products = await Product.find({
    isActive: true,
    createdAt: { $gte: since },
    "images.0": { $exists: true },
  })
    .select("images.publicId")
    .limit(batch)
    .lean()
    .maxTimeMS(8000);

  let optimized = 0;
  for (const p of products) {
    for (const img of p.images ?? []) {
      if (!img.publicId) continue;
      try {
        await cloudinaryInstance.uploader.explicit(img.publicId, {
          type: "upload",
          eager: [{ fetch_format: "auto", quality: "auto", width: 1200, crop: "limit" }],
          eager_async: false,
        });
        optimized += 1;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "optimize failed";
        logger.warn({
          msg: "image_optimize_skip",
          publicId: img.publicId,
          error: message,
        });
      }
    }
  }
  return optimized;
}
