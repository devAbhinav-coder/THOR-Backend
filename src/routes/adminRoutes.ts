import { Router } from 'express';
import {
  getDashboardAnalytics,
  getAdminAuditLogs,
  getAllOrders,
  getOrderDetails,
  updateOrderStatus,
  generateOrderInvoice,
  processRefund,
  getReturns,
  getReturnsInsights,
  resolveReturn,
  getAllUsers,
  getUserDirectoryStats,
  getUserInsights,
  toggleUserStatus,
  updateUserNote,
  updateUserRole,
  getAllReviews,
  deleteReview,
  replyToReview,
  sendCustomMarketingEmail,
} from '../controllers/adminController';
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
} from '../validation/schemas';
import {
  uploadAvatar,
  processCategoryImage,
  uploadStorefrontAssets,
  processStorefrontAssets,
} from '../middleware/upload';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';

const router = Router();
const adminSensitiveLimiter = createAdaptiveLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  prefix: 'rl:adaptive:admin:',
  message: 'Too many admin-sensitive actions. Please retry shortly.',
});

router.use(protect, restrictTo('admin'));

router.get('/analytics', getDashboardAnalytics);
router.get('/security/audit', getAdminAuditLogs);

router.get('/orders', getAllOrders);
router.get('/orders/:id', getOrderDetails);
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
router.get('/users', getAllUsers);
router.get('/users/:id/insights', getUserInsights);
router.patch('/users/:id/toggle-status', toggleUserStatus);
router.patch('/users/:id/role', validate(updateUserRoleSchema), updateUserRole);
router.patch('/users/:id/note', validate(updateUserNoteSchema), updateUserNote);

router.get('/reviews', getAllReviews);
router.delete('/reviews/:id', deleteReview);
router.patch('/reviews/:id/reply', replyToReview);
router.post('/emails/send', adminSensitiveLimiter, validate(sendMarketingEmailSchema), sendCustomMarketingEmail);

router.get('/storefront/settings', getAdminStorefrontSettings);
router.patch('/storefront/settings', uploadStorefrontAssets, processStorefrontAssets, updateStorefrontSettings);

// Category management
router.get('/categories', getAllCategories);
router.post('/categories', uploadAvatar, processCategoryImage, validate(createCategorySchema), createCategory);
router.patch('/categories/:id', uploadAvatar, processCategoryImage, updateCategory);
router.delete('/categories/:id', deleteCategory);

export default router;
