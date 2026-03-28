import { Router } from 'express';
import {
  getAllBlogs,
  getAdminBlogs,
  getBlogBySlug,
  createBlog,
  updateBlog,
  deleteBlog,
  likeBlog,
  addComment,
  deleteComment,
  deleteBlogImage,
} from '../controllers/blogController';
import { protect, restrictTo } from '../middleware/auth';
import { uploadBlogImages, processBlogImages } from '../middleware/upload';

const router = Router();

// Public routes
router.get('/', getAllBlogs);
router.get('/:slug', getBlogBySlug);

// Protected routes (Logged in users)
router.use(protect);
router.post('/:id/like', likeBlog);
router.post('/:id/comments', addComment);
router.delete('/:id/comments/:commentId', deleteComment);

// Admin routes
router.use(restrictTo('admin'));
router.get('/admin/all', getAdminBlogs); // Use /admin/all to avoid clash with :slug
router.post('/', uploadBlogImages, processBlogImages, createBlog);
router.patch('/:id', uploadBlogImages, processBlogImages, updateBlog);
router.delete('/:id', deleteBlog);
router.delete('/:id/images/:publicId', deleteBlogImage);

export default router;
