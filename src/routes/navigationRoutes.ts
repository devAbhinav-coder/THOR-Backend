import { Router } from 'express';
import { getMegaMenu } from '../controllers/navigationController';

const router = Router();

/**
 * GET /api/navigation/mega-menu
 * Public endpoint — returns all active shop categories with nested subcategories.
 * Used by the storefront navbar mega-menu. In-process cached for 300s.
 */
router.get('/mega-menu', getMegaMenu);

export default router;
