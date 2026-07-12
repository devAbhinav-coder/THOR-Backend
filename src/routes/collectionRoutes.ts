import { Router } from 'express';
import {
  getCollectionDetails,
  getCollectionProducts,
  getCollectionFilters,
  getSubcollectionDetails,
  getSubcollectionProducts,
  getSubcollectionFilters
} from '../controllers/collectionController';
import { validate } from '../middleware/validate';
import { productListQuerySchema } from '../validation/schemas';

const router = Router();

// Category level collections
router.get('/:catSlug', getCollectionDetails);
router.get('/:catSlug/products', validate(productListQuerySchema), getCollectionProducts);
router.get('/:catSlug/filters', getCollectionFilters);

// Subcategory level collections
router.get('/:catSlug/:subSlug', getSubcollectionDetails);
router.get('/:catSlug/:subSlug/products', validate(productListQuerySchema), getSubcollectionProducts);
router.get('/:catSlug/:subSlug/filters', getSubcollectionFilters);

export default router;
