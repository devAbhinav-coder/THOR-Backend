import { Router } from 'express';
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
} from '../controllers/productController';
import { protect, restrictTo } from '../middleware/auth';
import { uploadProductImages, processProductImages } from '../middleware/upload';
import { validate } from '../middleware/validate';
import { createProductSchema, updateProductSchema } from '../validation/schemas';

const router = Router();

router.get('/', getAllProducts);
router.get('/featured', getFeaturedProducts);
router.get('/filters', getFilterOptions);
router.get('/category/:category', getProductsByCategory);
router.post('/:slug/view', recordProductView);
router.get('/:slug', getProduct);

router.use(protect, restrictTo('admin'));

router.post('/', uploadProductImages, processProductImages, validate(createProductSchema), createProduct);
router.patch('/:id', uploadProductImages, processProductImages, validate(updateProductSchema), updateProduct);
router.delete('/:id', deleteProduct);
router.delete('/:id/images/:publicId', deleteProductImage);

export default router;
