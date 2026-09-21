import { Router } from "express";
import {
  getAllBlogs,
  getAdminBlogs,
  getRelatedBlogs,
  trackBlogShopClick,
  getBlogBySlug,
  createBlog,
  updateBlog,
  deleteBlog,
  likeBlog,
  addComment,
  deleteComment,
  deleteBlogImage,
  getBlogAnalytics,
} from "../controllers/blogController";
import {
  protect,
  requireAdminTwoFactor,
  requireExternalAdminApiAccess,
  restrictToAdminPanel,
} from "../middleware/auth";
import {
  uploadBlogImages,
  processBlogImages,
  handleBlogUploadError,
} from "../middleware/upload";
import { validate } from "../middleware/validate";
import {
  createBlogSchema,
  updateBlogSchema,
  blogIdParamSchema,
  blogCommentSchema,
  blogCommentDeleteSchema,
} from "../validation/blogSchemas";

const router = Router();

// Keep admin listing above `/:slug` to prevent route shadowing.
router.get(
  "/admin/all",
  protect,
  restrictToAdminPanel,
  requireExternalAdminApiAccess("blogs"),
  getAdminBlogs,
);
router.get(
  "/admin/analytics",
  protect,
  restrictToAdminPanel,
  requireExternalAdminApiAccess("blogs"),
  getBlogAnalytics,
);

// Public routes
router.get("/", getAllBlogs);
router.get("/:slug/related", getRelatedBlogs);
router.post("/:slug/track-shop-click", trackBlogShopClick);
router.get("/:slug", getBlogBySlug);

// Protected routes (Logged in users)
router.use(protect);
router.post("/:id/like", validate(blogIdParamSchema), likeBlog);
router.post("/:id/comments", validate(blogCommentSchema), addComment);
router.delete(
  "/:id/comments/:commentId",
  validate(blogCommentDeleteSchema),
  deleteComment,
);

// Admin routes - 2FA when enabled (prefer /api/admin/writes/blogs)
router.use(
  restrictToAdminPanel,
  requireExternalAdminApiAccess("blogs"),
  requireAdminTwoFactor,
);
router.post(
  "/",
  uploadBlogImages,
  handleBlogUploadError,
  processBlogImages,
  validate(createBlogSchema),
  createBlog,
);
router.patch(
  "/:id",
  uploadBlogImages,
  handleBlogUploadError,
  processBlogImages,
  validate(updateBlogSchema),
  updateBlog,
);
router.delete("/:id", validate(blogIdParamSchema), deleteBlog);
router.delete("/:id/images/:publicId", deleteBlogImage);

export default router;
