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
import { runDelhiveryTrackingSyncJob } from "../services/delhiveryTrackingSyncService";
import { runPaymentRecoveryJob } from "../services/paymentRecoveryJob";
import {
  backfillBlogEmbeddings,
  backfillProductEmbeddings,
} from "../services/ai/vectorIndexService";

export type MaintenanceJobRunner = () => Promise<
  void | number | Record<string, unknown>
>;

const runners = new Map<string, MaintenanceJobRunner>();

export function registerMaintenanceJobRunner(
  name: string,
  run: MaintenanceJobRunner,
): void {
  runners.set(name, run);
}

export function getMaintenanceJobRunner(
  name: string,
): MaintenanceJobRunner | undefined {
  return runners.get(name);
}

async function runEmbeddingBackfillJob(): Promise<Record<string, number>> {
  const productLimit = Number(process.env.EMBEDDING_BACKFILL_PRODUCT_LIMIT || 500);
  const blogLimit = Number(process.env.EMBEDDING_BACKFILL_BLOG_LIMIT || 200);
  const [products, blogs] = await Promise.all([
    backfillProductEmbeddings(productLimit),
    backfillBlogEmbeddings(blogLimit),
  ]);
  return { products, blogs };
}

function registerAll(): void {
  registerMaintenanceJobRunner("abandoned-cart-recovery", runAbandonedCartRecoveryJob);
  registerMaintenanceJobRunner("unpaid-order-auto-cancel", runUnpaidOrderAutoCancelJob);
  registerMaintenanceJobRunner("review-invite", runReviewInviteJob);
  registerMaintenanceJobRunner("coupon-expiry-cleanup", runCouponExpiryCleanupJob);
  registerMaintenanceJobRunner("sale-campaign-expire", runSaleCampaignExpireJob);
  registerMaintenanceJobRunner("outbox-dead-letter-handler", runOutboxDeadLetterHandlerJob);
  registerMaintenanceJobRunner("wishlist-price-drop", runWishlistPriceDropJob);
  registerMaintenanceJobRunner("low-stock-alert", runLowStockAlertJob);
  registerMaintenanceJobRunner("order-sla-breach", runOrderSlaBreachJob);
  registerMaintenanceJobRunner("session-cleanup", runSessionCleanupJob);
  registerMaintenanceJobRunner("sitemap-generator", runSitemapGeneratorJob);
  registerMaintenanceJobRunner("analytics-pre-aggregation", runAnalyticsPreAggregationJob);
  registerMaintenanceJobRunner("vector-embedding-refresh", runVectorEmbeddingRefreshJob);
  registerMaintenanceJobRunner("inactive-user-reengagement", runInactiveUserReengagementJob);
  registerMaintenanceJobRunner("return-auto-approve", runReturnAutoApproveJob);
  registerMaintenanceJobRunner("bulk-image-optimizer", runBulkImageOptimizerJob);
  registerMaintenanceJobRunner("delhivery-tracking-sync", runDelhiveryTrackingSyncJob);
  registerMaintenanceJobRunner("payment-recovery", runPaymentRecoveryJob);
  registerMaintenanceJobRunner("embedding-backfill", runEmbeddingBackfillJob);
}

registerAll();
