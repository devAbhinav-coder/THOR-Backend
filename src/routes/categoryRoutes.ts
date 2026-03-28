import { Router } from 'express';
import { getAllCategories, getCategory, getCategoryStats } from '../controllers/categoryController';

const router = Router();

router.get('/', getAllCategories);
router.get('/stats', getCategoryStats);
router.get('/:id', getCategory);

export default router;
