import { Router } from 'express';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import {
  getAllProducts,
  getProduct,
  recordProductView,
  getFeaturedProducts,
  getProductsByCategory,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductImage,
  getFilterOptions,
  searchProducts,
  autocompleteSearch,
  getSearchSuggestions,
  getTrendingSearches,
} from '../controllers/productController';
import { protect, restrictTo } from '../middleware/auth';
import { uploadProductImages, processProductImages } from '../middleware/upload';
import { validate } from '../middleware/validate';
import {
  createProductSchema,
  updateProductSchema,
  productListQuerySchema,
  productSearchQuerySchema,
  productAutocompleteQuerySchema,
  productSuggestionsQuerySchema,
  productTrendingQuerySchema,
  productSlugParamSchema,
} from '../validation/schemas';

const router = Router();

const autocompleteLimiter = createAdaptiveLimiter({
  windowMs: 60 * 1000,
  max: 40,
  prefix: 'rl:products:autocomplete:',
  message: 'Too many search suggestions. Please slow down.',
});

// Public storefront catalog only — admin uses GET /api/admin/products
router.get('/', validate(productListQuerySchema), getAllProducts);
router.get('/search', validate(productSearchQuerySchema), searchProducts);
router.get('/autocomplete', autocompleteLimiter, validate(productAutocompleteQuerySchema), autocompleteSearch);
router.get('/suggestions', autocompleteLimiter, validate(productSuggestionsQuerySchema), getSearchSuggestions);
router.get('/trending', validate(productTrendingQuerySchema), getTrendingSearches);
router.get('/featured', getFeaturedProducts);
router.get('/filters', getFilterOptions);
router.get('/category/:category', getProductsByCategory);
router.post('/:slug/view', validate(productSlugParamSchema), recordProductView);
router.get('/:slug', validate(productSlugParamSchema), getProduct);

// Admin routes (protected)
router.use(protect, restrictTo('admin'));

router.post('/', uploadProductImages, processProductImages, validate(createProductSchema), createProduct);
router.patch('/:id', uploadProductImages, processProductImages, validate(updateProductSchema), updateProduct);
router.delete('/:id', deleteProduct);
router.delete('/:id/images/:publicId', deleteProductImage);

export default router;
