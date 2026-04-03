import { Router } from 'express';
import {
  getDashboardAnalytics,
  getAdminAuditLogs,
  getAllOrders,
  getOrderDetails,
  updateOrderStatus,
  getAllUsers,
  toggleUserStatus,
  updateUserRole,
  getAllReviews,
  deleteReview,
  replyToReview,
  sendCustomMarketingEmail,
} from '../controllers/adminController';
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
import { updateOrderStatusSchema, createCategorySchema, sendMarketingEmailSchema, updateUserRoleSchema } from '../validation/schemas';
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
router.patch('/orders/:id/status', validate(updateOrderStatusSchema), updateOrderStatus);

router.get('/users', getAllUsers);
router.patch('/users/:id/toggle-status', toggleUserStatus);
router.patch('/users/:id/role', validate(updateUserRoleSchema), updateUserRole);

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
