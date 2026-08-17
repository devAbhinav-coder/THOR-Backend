import { createMaintenanceJob } from "./createMaintenanceJob";
import {
  runAbandonedCartRecoveryJob,
  runUnpaidOrderAutoCancelJob,
  runReviewInviteJob,
  runCouponExpiryCleanupJob,
  runSaleCampaignExpireJob,
  runOutboxDeadLetterHandlerJob,
} from "../services/jobs/criticalJobsService";
import {
  runWishlistPriceDropJob,
  runLowStockAlertJob,
  runOrderSlaBreachJob,
  runSessionCleanupJob,
  runSitemapGeneratorJob,
  runAnalyticsPreAggregationJob,
} from "../services/jobs/importantJobsService";
import {
  runVectorEmbeddingRefreshJob,
  runInactiveUserReengagementJob,
  runReturnAutoApproveJob,
  runBulkImageOptimizerJob,
} from "../services/jobs/niceToHaveJobsService";

const jobs = [
  createMaintenanceJob({
    name: "abandoned-cart-recovery",
    enabledEnv: "CART_ABANDON_JOB_ENABLED",
    intervalMs: Number(process.env.CART_ABANDON_JOB_MS || 60 * 60 * 1000),
    run: runAbandonedCartRecoveryJob,
    disabledLogMessage: "Abandoned cart recovery disabled",
  }),
  createMaintenanceJob({
    name: "unpaid-order-auto-cancel",
    enabledEnv: "UNPAID_ORDER_CANCEL_ENABLED",
    intervalMs: Number(process.env.UNPAID_ORDER_CANCEL_MS || 15 * 60 * 1000),
    run: runUnpaidOrderAutoCancelJob,
    disabledLogMessage: "Unpaid order auto-cancel disabled",
  }),
  createMaintenanceJob({
    name: "review-invite",
    enabledEnv: "REVIEW_INVITE_JOB_ENABLED",
    intervalMs: Number(process.env.REVIEW_INVITE_JOB_MS || 60 * 60 * 1000),
    run: runReviewInviteJob,
    disabledLogMessage: "Review invite job disabled",
  }),
  createMaintenanceJob({
    name: "coupon-expiry-cleanup",
    enabledEnv: "COUPON_EXPIRE_JOB_ENABLED",
    cronExpression: process.env.COUPON_EXPIRE_CRON || "0 0 * * *",
    useQueue: false,
    run: runCouponExpiryCleanupJob,
    disabledLogMessage: "Coupon expiry cleanup disabled",
  }),
  createMaintenanceJob({
    name: "sale-campaign-expire",
    enabledEnv: "SALE_EXPIRE_JOB_ENABLED",
    intervalMs: Number(process.env.SALE_EXPIRE_JOB_MS || 5 * 60 * 1000),
    useQueue: false,
    run: runSaleCampaignExpireJob,
    disabledLogMessage: "Sale campaign expire job disabled",
  }),
  createMaintenanceJob({
    name: "outbox-dead-letter-handler",
    enabledEnv: "OUTBOX_DLQ_HANDLER_ENABLED",
    intervalMs: Number(process.env.OUTBOX_DLQ_HANDLER_MS || 30 * 60 * 1000),
    run: runOutboxDeadLetterHandlerJob,
    disabledLogMessage: "Outbox dead-letter handler disabled",
  }),
  createMaintenanceJob({
    name: "wishlist-price-drop",
    enabledEnv: "WISHLIST_PRICE_DROP_JOB_ENABLED",
    intervalMs: Number(process.env.WISHLIST_PRICE_DROP_JOB_MS || 6 * 60 * 60 * 1000),
    run: runWishlistPriceDropJob,
    disabledLogMessage: "Wishlist price drop job disabled",
  }),
  createMaintenanceJob({
    name: "low-stock-alert",
    enabledEnv: "LOW_STOCK_ALERT_JOB_ENABLED",
    intervalMs: Number(process.env.LOW_STOCK_ALERT_JOB_MS || 2 * 60 * 60 * 1000),
    useQueue: false,
    run: runLowStockAlertJob,
    disabledLogMessage: "Low stock alert job disabled",
  }),
  createMaintenanceJob({
    name: "order-sla-breach",
    enabledEnv: "ORDER_SLA_JOB_ENABLED",
    intervalMs: Number(process.env.ORDER_SLA_JOB_MS || 60 * 60 * 1000),
    useQueue: false,
    run: runOrderSlaBreachJob,
    disabledLogMessage: "Order SLA breach job disabled",
  }),
  createMaintenanceJob({
    name: "session-cleanup",
    enabledEnv: "SESSION_CLEANUP_JOB_ENABLED",
    cronExpression: process.env.SESSION_CLEANUP_CRON || "0 4 * * *",
    useQueue: false,
    run: runSessionCleanupJob,
    disabledLogMessage: "Session cleanup job disabled",
  }),
  createMaintenanceJob({
    name: "sitemap-generator",
    enabledEnv: "SITEMAP_JOB_ENABLED",
    cronExpression: process.env.SITEMAP_CRON || "0 3 * * *",
    run: runSitemapGeneratorJob,
    disabledLogMessage: "Sitemap generator disabled",
  }),
  createMaintenanceJob({
    name: "analytics-pre-aggregation",
    enabledEnv: "ANALYTICS_ROLLUP_JOB_ENABLED",
    cronExpression: process.env.ANALYTICS_ROLLUP_CRON || "0 2 * * *",
    run: runAnalyticsPreAggregationJob,
    disabledLogMessage: "Analytics pre-aggregation disabled",
  }),
  createMaintenanceJob({
    name: "vector-embedding-refresh",
    enabledEnv: "EMBEDDING_REFRESH_JOB_ENABLED",
    cronExpression: process.env.EMBEDDING_REFRESH_CRON || "0 5 * * 0",
    run: runVectorEmbeddingRefreshJob,
    disabledLogMessage: "Vector embedding refresh disabled",
  }),
  createMaintenanceJob({
    name: "return-auto-approve",
    enabledEnv: "RETURN_AUTO_APPROVE_ENABLED",
    requireExplicitEnable: true,
    intervalMs: Number(process.env.RETURN_AUTO_APPROVE_MS || 2 * 60 * 60 * 1000),
    run: runReturnAutoApproveJob,
    disabledLogMessage: "Return auto-approve disabled (set RETURN_AUTO_APPROVE_ENABLED=true)",
  }),
  createMaintenanceJob({
    name: "inactive-user-reengagement",
    enabledEnv: "REENGAGE_JOB_ENABLED",
    requireExplicitEnable: true,
    cronExpression: process.env.REENGAGE_CRON || "0 10 * * 1",
    run: runInactiveUserReengagementJob,
    disabledLogMessage: "Inactive user re-engagement disabled",
  }),
  createMaintenanceJob({
    name: "bulk-image-optimizer",
    enabledEnv: "IMAGE_OPTIMIZE_JOB_ENABLED",
    requireExplicitEnable: true,
    cronExpression: process.env.IMAGE_OPTIMIZE_CRON || "0 2 * * *",
    run: runBulkImageOptimizerJob,
    disabledLogMessage: "Bulk image optimizer disabled",
  }),
];

export function startExtendedJobs(): void {
  for (const job of jobs) {
    job.start();
  }
}

export function stopExtendedJobs(): void {
  for (const job of jobs) {
    job.stop();
  }
}
