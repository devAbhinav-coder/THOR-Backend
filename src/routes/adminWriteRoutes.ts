import { Router } from "express";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductImage,
  getMotionVideoUploadSignature,
  getProductImageUploadSignature,
  getPremiumHeroUploadSignature,
} from "../controllers/productController";
import {
  createCoupon,
  updateCoupon,
  deleteCoupon,
  archiveCoupon,
} from "../controllers/couponController";
import {
  createSaleCampaign,
  updateSaleCampaign,
  deleteSaleCampaign,
  archiveSaleCampaign,
} from "../controllers/saleCampaignController";
import {
  createPromotion,
  updatePromotion,
  deletePromotion,
  archivePromotion,
} from "../controllers/promotionController";
import {
  createBlog,
  updateBlog,
  deleteBlog,
  deleteBlogImage,
} from "../controllers/blogController";
import {
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  approveTestimonial,
  rejectTestimonial,
} from "../controllers/testimonialController";
import { validate } from "../middleware/validate";
import {
  uploadProductImages,
  processProductImages,
  uploadCouponBanner,
  processCouponBanner,
  uploadSaleBanner,
  processSaleBanner,
  uploadPromotionBanner,
  processPromotionBanner,
  uploadBlogImages,
  processBlogImages,
  handleBlogUploadError,
  uploadReviewImages,
  processReviewImages,
} from "../middleware/upload";
import { assertReviewUploadSecurity } from "../middleware/reviewUploadSecurity";
import {
  createProductSchema,
  updateProductSchema,
  createCouponSchema,
  updateCouponSchema,
  couponIdParamsSchema,
} from "../validation/schemas";
import {
  createSaleCampaignSchema,
  updateSaleCampaignSchema,
  saleCampaignIdParamsSchema,
} from "../validation/saleSchemas";
import {
  createPromotionSchema,
  updatePromotionSchema,
  promotionIdParamsSchema,
} from "../validation/promotionSchemas";
import {
  createBlogSchema,
  updateBlogSchema,
  blogIdParamSchema,
} from "../validation/blogSchemas";
import {
  createTestimonialSchema,
  updateTestimonialSchema,
  testimonialIdParamSchema,
} from "../validation/testimonialSchemas";
import { ADMIN_WRITE_SURFACES } from "../config/adminWriteSurfaces";

/**
 * Canonical admin write surface — already behind /api/admin + 2FA.
 * Legacy public-prefix writes remain for compatibility; WAF should cover both.
 */
const router = Router();

router.get("/surfaces", (_req, res) => {
  res.json({ status: "success", data: { surfaces: ADMIN_WRITE_SURFACES } });
});

router.get("/products/motion-video/signature", getMotionVideoUploadSignature);
router.get("/products/images/signature", getProductImageUploadSignature);
router.get("/products/premium-hero/signature", getPremiumHeroUploadSignature);

router.post(
  "/products",
  uploadProductImages,
  processProductImages,
  validate(createProductSchema),
  createProduct,
);
router.patch(
  "/products/:id",
  uploadProductImages,
  processProductImages,
  validate(updateProductSchema),
  updateProduct,
);
router.delete("/products/:id", deleteProduct);
router.delete("/products/:id/images/:publicId", deleteProductImage);

router.post(
  "/coupons",
  uploadCouponBanner,
  processCouponBanner,
  validate(createCouponSchema),
  createCoupon,
);
router.patch("/coupons/:id/archive", validate(couponIdParamsSchema), archiveCoupon);
router.patch(
  "/coupons/:id",
  uploadCouponBanner,
  processCouponBanner,
  validate(updateCouponSchema),
  updateCoupon,
);
router.delete("/coupons/:id", validate(couponIdParamsSchema), deleteCoupon);

router.post(
  "/sales",
  uploadSaleBanner,
  processSaleBanner,
  validate(createSaleCampaignSchema),
  createSaleCampaign,
);
router.patch("/sales/:id/archive", validate(saleCampaignIdParamsSchema), archiveSaleCampaign);
router.patch(
  "/sales/:id",
  uploadSaleBanner,
  processSaleBanner,
  validate(updateSaleCampaignSchema),
  updateSaleCampaign,
);
router.delete("/sales/:id", validate(saleCampaignIdParamsSchema), deleteSaleCampaign);

router.post(
  "/promotions",
  uploadPromotionBanner,
  processPromotionBanner,
  validate(createPromotionSchema),
  createPromotion,
);
router.patch("/promotions/:id/archive", validate(promotionIdParamsSchema), archivePromotion);
router.patch(
  "/promotions/:id",
  uploadPromotionBanner,
  processPromotionBanner,
  validate(updatePromotionSchema),
  updatePromotion,
);
router.delete("/promotions/:id", validate(promotionIdParamsSchema), deletePromotion);

router.post(
  "/blogs",
  uploadBlogImages,
  handleBlogUploadError,
  processBlogImages,
  validate(createBlogSchema),
  createBlog,
);
router.patch(
  "/blogs/:id",
  uploadBlogImages,
  handleBlogUploadError,
  processBlogImages,
  validate(updateBlogSchema),
  updateBlog,
);
router.delete("/blogs/:id", validate(blogIdParamSchema), deleteBlog);
router.delete("/blogs/:id/images/:publicId", deleteBlogImage);

router.post(
  "/testimonials",
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  validate(createTestimonialSchema),
  createTestimonial,
);
router.patch("/testimonials/:id/approve", validate(testimonialIdParamSchema), approveTestimonial);
router.patch("/testimonials/:id/reject", validate(testimonialIdParamSchema), rejectTestimonial);
router.patch(
  "/testimonials/:id",
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  validate(updateTestimonialSchema),
  updateTestimonial,
);
router.delete("/testimonials/:id", validate(testimonialIdParamSchema), deleteTestimonial);

export default router;
