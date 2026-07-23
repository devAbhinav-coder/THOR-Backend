import { Router } from 'express';
import { getDashboardAnalytics }   from '../controllers/admin/adminAnalyticsController';
import { getRevenuePeriodSummaryHandler } from '../controllers/admin/adminRevenueController';
import { getAdminAuditLogs }       from '../controllers/admin/adminAuditController';
import {
  getAllOrders,
  getOrderDetails,
  deleteOrder,
  updateOrderStatus,
  generateOrderInvoice,
  processRefundController as processRefund,
} from '../controllers/admin/adminOrderController';
import {
  getReturns,
  getReturnsInsights,
  resolveReturnController as resolveReturn,
} from '../controllers/admin/adminReturnController';
import {
  getAllUsers,
  getOfflineCustomers,
  getUserDirectoryStats,
  getUserInsights,
  toggleUserStatus,
  updateUserNote,
  updateUserRole,
} from '../controllers/admin/adminUserController';
import {
  getAllReviews,
  deleteReview,
  replyToReview,
  moderateReview,
} from '../controllers/admin/adminReviewController';
import {
  adminGetReviewsQuerySchema,
  adminModerateReviewSchema,
  adminReplyReviewSchema,
  adminReviewIdParamSchema,
} from '../validation/reviewSchemas';
import {
  getMarketingAudiencePreview,
  sendCustomMarketingEmail,
} from '../controllers/admin/adminMarketingController';
import { createOfflineOrder } from '../controllers/adminOfflineOrderController';
import {
  adminCreateReviewInvite,
  adminEmailReviewInvite,
} from '../controllers/reviewInviteController';
import {
  listSalesInvoices,
  getSalesInvoice,
  createSalesInvoice,
  updateSalesInvoice,
  deleteSalesInvoice,
} from '../controllers/adminSalesInvoiceController';
import {
  getAdminProducts,
  getAdminProductById,
  searchAdminProducts,
} from '../controllers/adminProductsController';
import {
  getInventoryOverview,
  adjustVariantStock,
  getStockLedger,
  getInventoryValuation,
  listPurchaseInvoices,
  getPurchaseInvoice,
  createPurchaseInvoice,
  updatePurchaseInvoice,
  deletePurchaseInvoice,
  getGstPurchaseSummary,
} from '../controllers/inventoryController';
import {
  listOperatingExpensesHandler,
  getOperatingExpenseSummaryHandler,
  createOperatingExpenseHandler,
  updateOperatingExpenseHandler,
  voidOperatingExpenseHandler,
} from '../controllers/operatingExpenseController';
import {
  getDelhiveryIntegrationStatus,
  checkOrderPinServiceability,
  checkDelhiveryServiceabilityByPin,
  estimateDelhiveryForOrder,
  createDelhiveryShipmentForOrder,
  syncDelhiveryTrackingForOrder,
  getDelhiveryPackingSlip,
  getDelhiveryPackingSlipJson,
  downloadDelhiveryPackingSlipFile,
} from '../controllers/delhiveryAdminController';
import {
  getAdminStorefrontSettings,
  updateStorefrontSettings,
} from '../controllers/storefrontController';
import {
  createCategory,
  updateCategory,
  deleteCategory,
  getAllCategories,
} from '../controllers/categoryController';
import {
  listSubcategories,
  getSubcategory,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
  reorderSubcategories,
  listSubcategoriesByCategory,
} from '../controllers/admin/adminSubcategoryController';
import { getMegaMenu } from '../controllers/navigationController';

import { protect, restrictTo } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  updateOrderStatusSchema,
  processRefundSchema,
  createCategorySchema,
  sendMarketingEmailSchema,
  updateUserNoteSchema,
  updateUserRoleSchema,
  delhiveryEstimateSchema,
  delhiveryCreateShipmentSchema,
  delhiveryOrderIdParamsSchema,
  delhiveryServiceabilityQuerySchema,
  delhiveryPackingSlipQuerySchema,
  createOfflineOrderSchema,
  stockAdjustmentSchema,
  createPurchaseInvoiceSchema,
  updatePurchaseInvoiceSchema,
  inventoryOverviewQuerySchema,
  operatingExpenseListQuerySchema,
  operatingExpenseSummaryQuerySchema,
  createOperatingExpenseSchema,
  updateOperatingExpenseSchema,
  operatingExpenseIdParamsSchema,
  adminProductListQuerySchema,
  adminProductSearchQuerySchema,
  adminProductIdParamSchema,
  marketingAudiencePreviewQuerySchema,
} from '../validation/schemas';
import {
  uploadCategoryImages,
  processCategoryImages,
  uploadStorefrontAssets,
  processStorefrontAssets,
} from '../middleware/upload';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import {
  getContentPlans,
  createContentPlan,
  bulkCreateContentPlans,
  updateContentPlan,
  deleteContentPlan,
} from '../controllers/blogContentPlanController';
import { getNewsletterSubscribersAdmin } from '../controllers/newsletterController';
import { adminNewsletterListQuerySchema } from '../validation/newsletterSchemas';
import {
  getAdminAiStatus,
  getAdminDailyBrief,
  getAdminActionSuggestions,
  explainAdminOrder,
  explainAdminUser,
  explainAdminReturns,
  draftAdminProductCopy,
  draftAdminCatalogSeo,
  draftAdminReviewReply,
  draftAdminMarketingEmail,
  draftAdminBlogPost,
  planAdminBlogCalendar,
  askAdminStore,
} from '../controllers/admin/adminAiController';
import {
  adminAiAskSchema,
  adminAiOrderIdSchema,
  adminAiUserIdSchema,
  adminAiReviewIdSchema,
  adminAiProductDraftSchema,
  adminAiCatalogSeoDraftSchema,
  adminAiMarketingDraftSchema,
  adminAiBlogDraftSchema,
  adminAiBlogCalendarSchema,
  adminAiBriefQuerySchema,
} from '../validation/adminAiSchemas';

const router = Router();
const adminSensitiveLimiter = createAdaptiveLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  prefix: 'rl:adaptive:admin:',
  message: 'Too many admin-sensitive actions. Please retry shortly.',
});

const adminAiLimiter = createAdaptiveLimiter({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.AI_ADMIN_HOURLY_MAX || '30', 10),
  prefix: 'rl:adaptive:admin-ai:',
  message: 'AI request limit reached. Please try again later.',
});

router.use(protect, restrictTo('admin'));

router.get('/analytics', getDashboardAnalytics);
router.get('/revenue/summary', getRevenuePeriodSummaryHandler);

// ─── Admin AI (Groq) — server-side only, rate-limited ───────────────────────
router.get('/ai/status', getAdminAiStatus);
router.get('/ai/daily-brief', adminAiLimiter, validate(adminAiBriefQuerySchema), ...getAdminDailyBrief);
router.get('/ai/action-suggestions', adminAiLimiter, ...getAdminActionSuggestions);
router.get('/ai/explain/order/:orderId', adminAiLimiter, validate(adminAiOrderIdSchema), ...explainAdminOrder);
router.get('/ai/explain/user/:userId', adminAiLimiter, validate(adminAiUserIdSchema), ...explainAdminUser);
router.get('/ai/explain/returns', adminAiLimiter, ...explainAdminReturns);
router.post('/ai/draft/product', adminAiLimiter, validate(adminAiProductDraftSchema), ...draftAdminProductCopy);
router.post('/ai/draft/catalog-seo', adminAiLimiter, validate(adminAiCatalogSeoDraftSchema), ...draftAdminCatalogSeo);
router.post('/ai/draft/review/:reviewId', adminAiLimiter, validate(adminAiReviewIdSchema), ...draftAdminReviewReply);
router.post('/ai/draft/marketing-email', adminAiLimiter, validate(adminAiMarketingDraftSchema), ...draftAdminMarketingEmail);
router.post('/ai/draft/blog', adminAiLimiter, validate(adminAiBlogDraftSchema), ...draftAdminBlogPost);
router.post('/ai/blog-calendar/plan', adminAiLimiter, validate(adminAiBlogCalendarSchema), ...planAdminBlogCalendar);
router.post('/ai/ask', adminAiLimiter, validate(adminAiAskSchema), ...askAdminStore);

router.get('/security/audit', getAdminAuditLogs);

router.get('/products', validate(adminProductListQuerySchema), getAdminProducts);
router.get('/products/search', validate(adminProductSearchQuerySchema), searchAdminProducts);
router.get('/products/:id', validate(adminProductIdParamSchema), getAdminProductById);

router.get('/orders', getAllOrders);
router.post(
  '/orders/offline',
  adminSensitiveLimiter,
  validate(createOfflineOrderSchema),
  createOfflineOrder,
);
router.get('/orders/:id', getOrderDetails);
router.post('/orders/:id/review-invite', adminCreateReviewInvite);
router.post('/orders/:id/review-invite/email', adminEmailReviewInvite);
router.delete('/orders/:id', adminSensitiveLimiter, deleteOrder);
router.get('/delhivery/status', getDelhiveryIntegrationStatus);
router.get(
  '/delhivery/serviceability',
  validate(delhiveryServiceabilityQuerySchema),
  checkDelhiveryServiceabilityByPin,
);
router.get('/orders/:id/delhivery/pin-check', validate(delhiveryOrderIdParamsSchema), checkOrderPinServiceability);
router.post('/orders/:id/delhivery/estimate', validate(delhiveryEstimateSchema), estimateDelhiveryForOrder);
router.post('/orders/:id/delhivery/create-shipment', validate(delhiveryCreateShipmentSchema), createDelhiveryShipmentForOrder);
router.post('/orders/:id/delhivery/sync-tracking', validate(delhiveryOrderIdParamsSchema), syncDelhiveryTrackingForOrder);
router.get(
  '/orders/:id/delhivery/packing-slip',
  validate(delhiveryPackingSlipQuerySchema),
  getDelhiveryPackingSlip,
);
router.get(
  '/orders/:id/delhivery/packing-slip/file',
  validate(delhiveryPackingSlipQuerySchema),
  downloadDelhiveryPackingSlipFile,
);
router.get(
  '/orders/:id/delhivery/packing-slip/json',
  validate(delhiveryPackingSlipQuerySchema),
  getDelhiveryPackingSlipJson,
);
router.patch('/orders/:id/status', validate(updateOrderStatusSchema), updateOrderStatus);
router.post('/orders/:id/generate-invoice', generateOrderInvoice);
router.post('/orders/:id/refund', validate(processRefundSchema), processRefund);
router.patch('/orders/:id/return/resolve', resolveReturn);

router.get('/returns/insights', getReturnsInsights);
router.get('/returns', getReturns);

router.get('/users/stats', getUserDirectoryStats);
router.get(
  '/newsletter-subscribers',
  validate(adminNewsletterListQuerySchema),
  getNewsletterSubscribersAdmin,
);
router.get('/offline-customers', getOfflineCustomers);
router.get('/users', getAllUsers);
router.get('/users/:id/insights', getUserInsights);
router.patch('/users/:id/toggle-status', toggleUserStatus);
router.patch('/users/:id/role', validate(updateUserRoleSchema), updateUserRole);
router.patch('/users/:id/note', validate(updateUserNoteSchema), updateUserNote);

router.get('/reviews', validate(adminGetReviewsQuerySchema), getAllReviews);
router.delete(
  '/reviews/:id',
  adminSensitiveLimiter,
  validate(adminReviewIdParamSchema),
  deleteReview
);
router.patch(
  '/reviews/:id/reply',
  validate(adminReplyReviewSchema),
  replyToReview
);
router.patch(
  '/reviews/:id/moderate',
  adminSensitiveLimiter,
  validate(adminModerateReviewSchema),
  moderateReview
);
router.get(
  '/emails/audience-preview',
  validate(marketingAudiencePreviewQuerySchema),
  getMarketingAudiencePreview,
);
router.post('/emails/send', adminSensitiveLimiter, validate(sendMarketingEmailSchema), sendCustomMarketingEmail);

router.get('/storefront/settings', getAdminStorefrontSettings);
router.patch('/storefront/settings', uploadStorefrontAssets, processStorefrontAssets, updateStorefrontSettings);

// Sales invoices (admin-only B2B / bulk-order tax invoices)
router.get('/invoices', listSalesInvoices);
router.post('/invoices', adminSensitiveLimiter, createSalesInvoice);
router.get('/invoices/:id', getSalesInvoice);
router.put('/invoices/:id', adminSensitiveLimiter, updateSalesInvoice);
router.delete('/invoices/:id', adminSensitiveLimiter, deleteSalesInvoice);

// Category management
router.get('/categories', getAllCategories);
router.post('/categories', uploadCategoryImages, processCategoryImages, validate(createCategorySchema), createCategory);
router.patch('/categories/:id', uploadCategoryImages, processCategoryImages, updateCategory);
router.delete('/categories/:id', deleteCategory);
router.get('/categories/:id/subcategories', listSubcategoriesByCategory);

// SubCategory management
router.get('/subcategories', listSubcategories);
router.post('/subcategories', adminSensitiveLimiter, uploadCategoryImages, processCategoryImages, createSubcategory);
router.patch('/subcategories/reorder', adminSensitiveLimiter, reorderSubcategories);
router.get('/subcategories/:id', getSubcategory);
router.patch('/subcategories/:id', adminSensitiveLimiter, uploadCategoryImages, processCategoryImages, updateSubcategory);
router.delete('/subcategories/:id', adminSensitiveLimiter, deleteSubcategory);


// ─── Inventory Management ─────────────────────────────────────────────────────
router.get('/inventory', validate(inventoryOverviewQuerySchema), getInventoryOverview);
router.patch('/inventory/products/:id/variants/:sku/stock', adminSensitiveLimiter, validate(stockAdjustmentSchema), adjustVariantStock);
router.get('/inventory/ledger', getStockLedger);
router.get('/inventory/valuation', getInventoryValuation);
router.get('/inventory/purchase-invoices', listPurchaseInvoices);
router.post('/inventory/purchase-invoices', adminSensitiveLimiter, validate(createPurchaseInvoiceSchema), createPurchaseInvoice);
router.get('/inventory/purchase-invoices/:id', getPurchaseInvoice);
router.put('/inventory/purchase-invoices/:id', adminSensitiveLimiter, validate(updatePurchaseInvoiceSchema), updatePurchaseInvoice);
router.delete('/inventory/purchase-invoices/:id', adminSensitiveLimiter, deletePurchaseInvoice);
router.get('/inventory/gst-summary', getGstPurchaseSummary);

// ─── Operating expenses (shipping, packing, ads, misc.) ─────────────────────
router.get('/operating-expenses', validate(operatingExpenseListQuerySchema), listOperatingExpensesHandler);
router.get('/operating-expenses/summary', validate(operatingExpenseSummaryQuerySchema), getOperatingExpenseSummaryHandler);
router.post('/operating-expenses', adminSensitiveLimiter, validate(createOperatingExpenseSchema), createOperatingExpenseHandler);
router.put('/operating-expenses/:id', adminSensitiveLimiter, validate(updateOperatingExpenseSchema), updateOperatingExpenseHandler);
router.delete('/operating-expenses/:id', adminSensitiveLimiter, validate(operatingExpenseIdParamsSchema), voidOperatingExpenseHandler);

// ─── Blog content calendar ────────────────────────────────────────────────────
router.get('/blog-content-plans', getContentPlans);
router.post('/blog-content-plans', createContentPlan);
router.post('/blog-content-plans/bulk', bulkCreateContentPlans);
router.patch('/blog-content-plans/:id', updateContentPlan);
router.delete('/blog-content-plans/:id', deleteContentPlan);

export default router;
