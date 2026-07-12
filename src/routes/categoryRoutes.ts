import { Router } from 'express';
import {
  getAllCategories,
  getCategory,
  getCategoryBySlug,
  getCategorySubcategories,
  getCategoryStats,
} from '../controllers/categoryController';

const router = Router();

router.get('/', getAllCategories);
router.get('/stats', getCategoryStats);
// Slug-based lookups (new — must come before /:id to avoid param ambiguity)
router.get('/slug/:slug', getCategoryBySlug);
router.get('/slug/:slug/subcategories', getCategorySubcategories);
// Legacy ObjectId lookup
router.get('/:id', getCategory);

export default router;
