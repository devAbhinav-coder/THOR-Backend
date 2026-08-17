import fs from "fs/promises";
import path from "path";
import { Types } from "mongoose";
import Wishlist from "../../models/Wishlist";
import WishlistPriceAlert from "../../models/WishlistPriceAlert";
import Product from "../../models/Product";
import Order from "../../models/Order";
import User from "../../models/User";
import RefreshToken from "../../models/RefreshToken";
import AuthOtp from "../../models/AuthOtp";
import AnalyticsDailySnapshot from "../../models/AnalyticsDailySnapshot";
import Blog from "../../models/Blog";
import Category from "../../models/Category";
import logger from "../../types/utils/logger";
import { emailTemplates } from "../emailService";
import { enqueueEmail } from "../../queues/emailQueue";
import { queuePushForUser } from "../notifications/notificationDeliveryService";
import { notifyAdmins, notifyAdminsEmail } from "../notificationService";
import { resolveEffectivePrice } from "../sale/salePriceService";
import { getActiveSaleCampaigns } from "../sale/saleCacheService";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../../constants/inventory";
import { shouldSendJobAlert } from "../../jobs/jobAlertDedupe";
import {
  advanceJobBatchCursor,
  clearJobBatchCursor,
  getJobBatchCursor,
} from "../../jobs/jobBatchCursor";
import { cloudinaryInstance } from "../cloudinary";
import StoreVisitSession from "../../models/StoreVisitSession";
import { istYesterdayWindow } from "../../utils/istDate";

const PAYMENT_STATUS_GROSS = {
  paymentStatus: { $in: ["paid", "refunded"] as const },
};

const frontendUrl = (process.env.FRONTEND_URL || "https://thehouseofrani.com").replace(
  /\/$/,
  "",
);

type WishlistAlertSnapshot = {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  product: Types.ObjectId;
  baselinePrice: number;
  lastNotifiedPrice?: number;
  lastNotifiedAt?: Date;
};

function isObjectIdString(value: string): boolean {
  return Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value;
}

function resolveRefId(ref: unknown): string | null {
  if (ref == null) return null;
  if (typeof ref === "string") {
    return isObjectIdString(ref) ? ref : null;
  }
  if (typeof ref === "object" && "_id" in ref) {
    const id = String((ref as { _id: unknown })._id);
    return isObjectIdString(id) ? id : null;
  }
  const id = String(ref);
  return isObjectIdString(id) ? id : null;
}

/** Wishlist items with 10%+ price drop → email/push (batch-optimized, cursor pagination). */
export async function runWishlistPriceDropJob(): Promise<number> {
  const minDropPct = Number(process.env.WISHLIST_PRICE_DROP_MIN_PCT || 10);
  const batch = Number(process.env.WISHLIST_PRICE_DROP_BATCH || 100);
  const cooldownMs = Number(
    process.env.WISHLIST_PRICE_DROP_COOLDOWN_MS || 7 * 24 * 60 * 60 * 1000,
  );
  const cooldownSince = new Date(Date.now() - cooldownMs);

  const cursorRaw = await getJobBatchCursor("wishlist-price-drop");
  const cursor =
    cursorRaw && isObjectIdString(cursorRaw) ? cursorRaw : null;
  if (cursorRaw && !cursor) {
    logger.warn({
      msg: "job_cursor_invalid",
      job: "wishlist-price-drop",
      cursor: cursorRaw,
    });
    await clearJobBatchCursor("wishlist-price-drop");
  }

  const wishlists = await Wishlist.find({
    "products.0": { $exists: true },
    ...(cursor ? { _id: { $gt: new Types.ObjectId(cursor) } } : {}),
  })
    .populate("user", "name email isActive")
    .sort({ _id: 1 })
    .limit(batch)
    .lean()
    .maxTimeMS(10000);

  await advanceJobBatchCursor(
    "wishlist-price-drop",
    wishlists,
    batch,
    (row) => String((row as { _id: unknown })._id),
  );

  if (!wishlists.length) return 0;

  const allProductIds = [
    ...new Set(
      wishlists.flatMap((wl) =>
        (wl.products ?? [])
          .map((id) => resolveRefId(id))
          .filter((id): id is string => id != null),
      ),
    ),
  ];
  if (!allProductIds.length) return 0;

  const wishlistUserIds = [
    ...new Set(
      wishlists
        .map((wl) => resolveRefId(wl.user))
        .filter((id): id is string => id != null),
    ),
  ];

  const [campaigns, products, existingAlerts] = await Promise.all([
    getActiveSaleCampaigns(),
    Product.find({ _id: { $in: allProductIds }, isActive: true })
      .select("name slug price")
      .lean(),
    wishlistUserIds.length
      ? WishlistPriceAlert.find({
          user: { $in: wishlistUserIds },
          product: { $in: allProductIds },
        }).lean()
      : Promise.resolve([]),
  ]);

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const alertMap = new Map<string, WishlistAlertSnapshot>(
    existingAlerts.map((a) => [
      `${String(a.user)}:${String(a.product)}`,
      {
        _id: a._id,
        user: a.user as Types.ObjectId,
        product: a.product as Types.ObjectId,
        baselinePrice: a.baselinePrice,
        lastNotifiedPrice: a.lastNotifiedPrice,
        lastNotifiedAt: a.lastNotifiedAt,
      },
    ]),
  );

  const alertsToCreate: Array<{
    user: Types.ObjectId;
    product: Types.ObjectId;
    baselinePrice: number;
  }> = [];

  let alerts = 0;

  for (const wl of wishlists) {
    const user = wl.user as unknown as {
      _id?: unknown;
      name?: string;
      email?: string;
      isActive?: boolean;
    };
    const userId = resolveRefId(user) ?? resolveRefId(wl.user);
    if (!userId || user?.isActive === false) continue;

    for (const productId of wl.products ?? []) {
      const pid = resolveRefId(productId);
      if (!pid) continue;
      const product = productMap.get(pid);
      if (!product) continue;

      const currentPrice = resolveEffectivePrice(
        { price: product.price, _id: pid },
        campaigns,
      ).effectivePrice;

      const alertKey = `${userId}:${pid}`;
      let alert = alertMap.get(alertKey);
      if (!alert) {
        alertsToCreate.push({
          user: new Types.ObjectId(userId),
          product: new Types.ObjectId(pid),
          baselinePrice: currentPrice,
        });
        continue;
      }

      if (alert.lastNotifiedAt && alert.lastNotifiedAt >= cooldownSince) {
        continue;
      }

      const baseline = alert.baselinePrice;
      if (baseline <= 0 || currentPrice >= baseline) continue;

      const dropPct = ((baseline - currentPrice) / baseline) * 100;
      if (dropPct < minDropPct) continue;

      const name = user.name || "there";
      const tpl = emailTemplates.wishlistPriceDrop(
        name,
        product.name,
        baseline,
        currentPrice,
        dropPct,
        `${frontendUrl}/products/${product.slug}`,
      );

      if (user.email) {
        await enqueueEmail({
          to: user.email,
          subject: tpl.subject,
          html: tpl.html,
        });
      }

      await queuePushForUser(
        {
          userId,
          title: "Price drop on your wishlist",
          body: `${product.name} is now ₹${currentPrice.toFixed(0)} (${dropPct.toFixed(0)}% off).`,
          link: `/products/${product.slug}`,
        },
        { category: "promotion" },
      ).catch(() => {});

      await WishlistPriceAlert.updateOne(
        { _id: alert._id },
        {
          $set: {
            lastNotifiedPrice: currentPrice,
            lastNotifiedAt: new Date(),
          },
        },
      );
      alerts += 1;
    }
  }

  if (alertsToCreate.length > 0) {
    const created = await WishlistPriceAlert.insertMany(alertsToCreate, {
      ordered: false,
    });
    for (const row of created) {
      alertMap.set(`${String(row.user)}:${String(row.product)}`, {
        _id: row._id,
        user: row.user as Types.ObjectId,
        product: row.product as Types.ObjectId,
        baselinePrice: row.baselinePrice,
        lastNotifiedPrice: row.lastNotifiedPrice,
        lastNotifiedAt: row.lastNotifiedAt,
      });
    }
  }

  return alerts;
}

/** Products at/below stock threshold → admin alert (deduped). */
export async function runLowStockAlertJob(): Promise<number> {
  const threshold = Number(
    process.env.LOW_STOCK_THRESHOLD || LOW_STOCK_ALERT_EXCLUSIVE_MAX,
  );
  const batch = Number(process.env.LOW_STOCK_ALERT_BATCH || 50);
  const cooldownMs = Number(
    process.env.LOW_STOCK_ALERT_COOLDOWN_MS || 6 * 60 * 60 * 1000,
  );

  const canAlert = await shouldSendJobAlert("low-stock", cooldownMs);
  if (!canAlert) return 0;

  const products = await Product.find({
    isActive: true,
    variants: { $elemMatch: { stock: { $lte: threshold, $gte: 0 } } },
  })
    .select("name slug variants.sku variants.stock variants.size variants.color")
    .limit(batch * 3)
    .lean()
    .maxTimeMS(8000);

  const alertProducts: typeof products = [];
  for (const p of products) {
    const canProductAlert = await shouldSendJobAlert(
      `low-stock:${String(p._id)}`,
      cooldownMs,
    );
    if (canProductAlert) alertProducts.push(p);
    if (alertProducts.length >= batch) break;
  }

  if (!alertProducts.length) return 0;

  const lines = alertProducts
    .map((p) => {
      const low = (p.variants ?? []).filter((v) => v.stock <= threshold);
      const skus = low.map((v) => `${v.sku}(${v.stock})`).join(", ");
      return `<li><b>${p.name}</b> — ${skus}</li>`;
    })
    .join("");

  await notifyAdmins(
    "Low stock alert",
    `${alertProducts.length} product(s) at or below ${threshold} units.`,
    "/admin/products",
    "alert",
  );
  await notifyAdminsEmail(
    "Low stock alert — The House of Rani",
    `<p>The following products need restocking (threshold ≤ ${threshold}):</p><ul>${lines}</ul>`,
  );

  return alertProducts.length;
}

/** Orders not shipped within SLA → admin alert (deduped). */
export async function runOrderSlaBreachJob(): Promise<number> {
  const shipSlaMs = Number(
    process.env.ORDER_SLA_SHIP_MS || 2 * 24 * 60 * 60 * 1000,
  );
  const batch = Number(process.env.ORDER_SLA_BATCH || 50);
  const cooldownMs = Number(
    process.env.ORDER_SLA_ALERT_COOLDOWN_MS || 6 * 60 * 60 * 1000,
  );
  const cutoff = new Date(Date.now() - shipSlaMs);
  const slaAlertCutoff = new Date(Date.now() - cooldownMs);

  const canAlert = await shouldSendJobAlert("order-sla-breach", cooldownMs);
  if (!canAlert) return 0;

  const overdue = await Order.find({
    status: { $in: ["confirmed", "processing"] },
    createdAt: { $lt: cutoff },
    $and: [
      {
        $or: [
          { paymentStatus: "paid" },
          { paymentMethod: "cod", paymentStatus: { $in: ["paid", "pending"] } },
        ],
      },
      {
        $or: [{ slaAlertedAt: null }, { slaAlertedAt: { $lt: slaAlertCutoff } }],
      },
    ],
  })
    .select("orderNumber status createdAt total")
    .sort({ createdAt: 1 })
    .limit(batch)
    .lean()
    .maxTimeMS(8000);

  if (!overdue.length) return 0;

  const lines = overdue
    .map(
      (o) =>
        `<li>${o.orderNumber} — ${o.status} since ${new Date(o.createdAt).toLocaleDateString("en-IN")}</li>`,
    )
    .join("");

  await notifyAdmins(
    "Order SLA breach",
    `${overdue.length} order(s) not shipped within ${Math.round(shipSlaMs / 86400000)} day(s).`,
    "/admin/orders",
    "alert",
  );
  await notifyAdminsEmail(
    "Order SLA breach — The House of Rani",
    `<p>These orders exceed the shipping SLA:</p><ul>${lines}</ul>`,
  );

  await Order.updateMany(
    { _id: { $in: overdue.map((o) => o._id) } },
    { $set: { slaAlertedAt: new Date() } },
  );

  return overdue.length;
}

/** Purge expired/revoked auth artifacts. */
export async function runSessionCleanupJob(): Promise<{
  refreshTokens: number;
  otps: number;
}> {
  const now = new Date();
  const revokedRetentionDays = Number(
    process.env.REVOKE_TOKEN_RETENTION_DAYS || 7,
  );
  const revokedBefore = new Date(
    Date.now() - revokedRetentionDays * 24 * 60 * 60 * 1000,
  );

  const [refreshResult, otpResult] = await Promise.all([
    RefreshToken.deleteMany({
      $or: [
        { expiresAt: { $lt: now } },
        { revokedAt: { $lt: revokedBefore, $ne: null } },
      ],
    }),
    AuthOtp.deleteMany({ expiresAt: { $lt: now } }),
  ]);

  return {
    refreshTokens: refreshResult.deletedCount ?? 0,
    otps: otpResult.deletedCount ?? 0,
  };
}

/** Generate sitemap.xml from catalog content. */
export async function runSitemapGeneratorJob(): Promise<number> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SITEMAP_CLOUDINARY_UPLOAD !== "true"
  ) {
    logger.warn({
      msg: "sitemap_ephemeral_disk",
      hint: "Set SITEMAP_CLOUDINARY_UPLOAD=true so sitemap survives container restarts",
    });
  }

  const outputPath =
    process.env.SITEMAP_OUTPUT_PATH ||
    path.join(process.cwd(), "public", "sitemap.xml");

  const [products, blogs, categories] = await Promise.all([
    Product.find({ isActive: true }).select("slug updatedAt").lean(),
    Blog.find({ isPublished: true }).select("slug updatedAt").lean(),
    Category.find({ isActive: true }).select("slug updatedAt").lean(),
  ]);

  const urls: string[] = [
    `${frontendUrl}/`,
    `${frontendUrl}/shop`,
    `${frontendUrl}/blog`,
  ];

  for (const p of products) {
    if (p.slug) {
      urls.push(`${frontendUrl}/products/${encodeURIComponent(p.slug)}`);
    }
  }
  for (const b of blogs) {
    if (b.slug) {
      urls.push(`${frontendUrl}/blog/${encodeURIComponent(b.slug)}`);
    }
  }
  for (const c of categories) {
    if (c.slug) {
      urls.push(`${frontendUrl}/shop?category=${encodeURIComponent(c.slug)}`);
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((loc) => `  <url><loc>${loc}</loc><changefreq>weekly</changefreq></url>`).join("\n")}
</urlset>`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, body, "utf8");

  if (
    process.env.SITEMAP_CLOUDINARY_UPLOAD === "true" &&
    process.env.CLOUDINARY_CLOUD_NAME
  ) {
    try {
      const uploaded = await cloudinaryInstance.uploader.upload(outputPath, {
        resource_type: "raw",
        public_id: process.env.SITEMAP_CLOUDINARY_PUBLIC_ID || "sitemap/sitemap",
        overwrite: true,
      });
      logger.info({
        msg: "sitemap_uploaded_cloudinary",
        url: uploaded.secure_url,
      });
    } catch (err: unknown) {
      logger.warn({
        msg: "sitemap_cloudinary_upload_failed",
        error: (err as Error).message,
      });
    }
  }

  logger.info({ msg: "sitemap_generated", path: outputPath, urlCount: urls.length });
  return urls.length;
}

/** Pre-compute yesterday's analytics snapshot. */
export async function runAnalyticsPreAggregationJob(): Promise<number> {
  const { dateKey, start, end } = istYesterdayWindow();
  const [
    orderAgg,
    cancelledOrders,
    newUsers,
    siteVisits,
    couponAgg,
    refundAgg,
  ] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lt: end },
          ...PAYMENT_STATUS_GROSS,
        },
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: "$total" },
          orders: { $sum: 1 },
          paidOrders: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] },
          },
        },
      },
    ]).option({ maxTimeMS: 15000 }),
    Order.countDocuments({
      status: "cancelled",
      createdAt: { $gte: start, $lt: end },
    }).maxTimeMS(5000),
    User.countDocuments({ createdAt: { $gte: start, $lt: end } }).maxTimeMS(5000),
    StoreVisitSession.countDocuments({ visitDate: dateKey }).maxTimeMS(5000),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lt: end },
          $or: [{ coupon: { $exists: true, $ne: null } }, { discount: { $gt: 0 } }],
        },
      },
      { $group: { _id: null, total: { $sum: "$discount" } } },
    ]).option({ maxTimeMS: 10000 }),
    Order.aggregate([
      {
        $match: {
          "refundData.processedAt": { $gte: start, $lt: end },
        },
      },
      { $group: { _id: null, total: { $sum: "$refundData.amount" } } },
    ]).option({ maxTimeMS: 10000 }),
  ]);

  const allOrdersCount = await Order.countDocuments({
    createdAt: { $gte: start, $lt: end },
  }).maxTimeMS(5000);

  const stats = orderAgg[0] ?? {
    revenue: 0,
    orders: 0,
    paidOrders: 0,
  };
  const avgOrderValue =
    stats.paidOrders > 0 ? stats.revenue / stats.paidOrders : 0;

  await AnalyticsDailySnapshot.findOneAndUpdate(
    { date: dateKey },
    {
      $set: {
        revenue: stats.revenue,
        orders: allOrdersCount,
        paidOrders: stats.paidOrders,
        cancelledOrders,
        newUsers,
        avgOrderValue,
        siteVisits,
        couponDiscount: couponAgg[0]?.total ?? 0,
        refundedAmount: refundAgg[0]?.total ?? 0,
        computedAt: new Date(),
      },
    },
    { upsert: true },
  );

  return 1;
}
