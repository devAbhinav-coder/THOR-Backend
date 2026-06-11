import { Router } from 'express';
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
} from '../controllers/blogController';
import { protect, restrictTo } from '../middleware/auth';
import {
  uploadBlogImages,
  processBlogImages,
  handleBlogUploadError,
} from '../middleware/upload';

const router = Router();

// Keep admin listing above `/:slug` to prevent route shadowing.
router.get('/admin/all', protect, restrictTo('admin'), getAdminBlogs);
router.get('/admin/analytics', protect, restrictTo('admin'), getBlogAnalytics);

// Public routes
router.get('/', getAllBlogs);
router.get('/:slug/related', getRelatedBlogs);
router.post('/:slug/track-shop-click', trackBlogShopClick);
router.get('/:slug', getBlogBySlug);

// Protected routes (Logged in users)
router.use(protect);
router.post('/:id/like', likeBlog);
router.post('/:id/comments', addComment);
router.delete('/:id/comments/:commentId', deleteComment);

// Admin routes
router.use(restrictTo('admin'));
router.post('/', uploadBlogImages, handleBlogUploadError, processBlogImages, createBlog);
router.patch('/:id', uploadBlogImages, handleBlogUploadError, processBlogImages, updateBlog);
router.delete('/:id', deleteBlog);
router.delete('/:id/images/:publicId', deleteBlogImage);

export default router;
