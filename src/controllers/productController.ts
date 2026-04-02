import { Request, Response, NextFunction } from 'express';
import Product from '../models/Product';
import { deleteMultipleImages } from '../services/cloudinary';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import APIFeatures from '../utils/apiFeatures';
import { IProduct } from '../types';
import { reconcileProductJson, sumVariantStocks } from '../utils/productStock';
import { getCache, setCache } from '../services/cacheService';
import { productRepository } from '../repositories/productRepository';
import { sendPaginated, sendSuccess } from '../utils/response';
import { safeJsonParse } from '../utils/safeJson';

function jsonProduct(p: { toJSON: () => Record<string, unknown> }) {
  const raw = p.toJSON() as Record<string, unknown> & { variants?: { stock?: number }[] };
  return reconcileProductJson(raw);
}

export const getAllProducts = catchAsync(async (req: Request, res: Response) => {
  const features = new APIFeatures<IProduct>(
    Product.find({ isActive: true, category: { $ne: 'Gifting' } }),
    req.query as Record<string, string>
  )
    .filter()
    .search(['name', 'description', 'tags'])
    .sort()
    .limitFields()
    .paginate();

  const [products, totalCount] = await Promise.all([
    features.query,
    Product.countDocuments(features.getMongoFilter()),
  ]);
  sendPaginated(
    res,
    { products: products.map((p) => jsonProduct(p)) },
    { page: features.getPage(), limit: features.getLimit(), total: totalCount }
  );
});

/** Public: increment PDP view count (client dedupes per session). */
export const recordProductView = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const updated = await Product.findOneAndUpdate(
    { slug: req.params.slug, isActive: true },
    { $inc: { viewCount: 1 } },
    { new: true, select: 'viewCount' }
  );

  if (!updated) {
    return next(new AppError('No product found with that slug.', 404));
  }

  sendSuccess(res, { viewCount: updated.viewCount });
});

export const getProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true });

  if (!product) {
    return next(new AppError('No product found with that slug.', 404));
  }

  sendSuccess(res, { product: jsonProduct(product) });
});

export const getFeaturedProducts = catchAsync(async (_req: Request, res: Response) => {
  const cacheKey = 'cache:products:featured';
  const cached = await getCache<Record<string, unknown>[]>(cacheKey);
  if (cached) {
    sendSuccess(res, { products: cached });
    return;
  }

  const products = await productRepository.findFeatured();
  const transformed = products.map((p) => jsonProduct(p));
  await setCache(cacheKey, transformed, 120);

  sendSuccess(res, { products: transformed });
});

export const getProductsByCategory = catchAsync(async (req: Request, res: Response) => {
  const features = new APIFeatures<IProduct>(
    Product.find({ category: req.params.category, isActive: true }),
    req.query as Record<string, string>
  )
    .filter()
    .sort()
    .paginate();

  const [products, totalCount] = await Promise.all([
    features.query,
    Product.countDocuments(features.getMongoFilter()),
  ]);
  sendPaginated(
    res,
    { products: products.map((p) => jsonProduct(p)) },
    { page: features.getPage(), limit: features.getLimit(), total: totalCount }
  );
});

export const createProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const uploadedImages = (req as Request & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;

  if (!uploadedImages || uploadedImages.length === 0) {
    return next(new AppError('Please upload at least one product image.', 400));
  }

  if (uploadedImages.length > 7) {
    return next(new AppError('A product can have at most 7 images.', 400));
  }

  const images = uploadedImages.map((img, index) => ({
    url: img.url,
    publicId: img.publicId,
    alt: `${req.body.name} - Image ${index + 1}`,
  }));

  const variantsParsed = safeJsonParse(req.body.variants, req.body.variants, 'variants');

  const productData = {
    ...req.body,
    images,
    variants: variantsParsed,
    tags: safeJsonParse(req.body.tags, req.body.tags, 'tags'),
    price: Number(req.body.price),
    comparePrice: req.body.comparePrice ? Number(req.body.comparePrice) : undefined,
    isFeatured: req.body.isFeatured === 'true' || req.body.isFeatured === true,
    isActive: req.body.isActive !== 'false' && req.body.isActive !== false,
    isGiftable: req.body.isGiftable === 'true' || req.body.isGiftable === true,
    minOrderQty: req.body.minOrderQty ? Number(req.body.minOrderQty) : 1,
    giftOccasions: safeJsonParse(req.body.giftOccasions, req.body.giftOccasions || [], 'giftOccasions'),
    customFields: safeJsonParse(req.body.customFields, req.body.customFields || [], 'customFields'),
    productDetails: safeJsonParse(req.body.productDetails, req.body.productDetails || [], 'productDetails'),
  };
  delete (productData as Record<string, unknown>).totalStock;
  (productData as Record<string, unknown>).totalStock = sumVariantStocks(variantsParsed);

  const product = await Product.create(productData);

  sendSuccess(res, { product: jsonProduct(product) }, 'Product created', 201);
});

export const updateProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new AppError('No product found with that ID.', 404));

  const updateData: Record<string, unknown> = { ...req.body };

  const uploadedImages = (req as Request & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;
  if (uploadedImages && uploadedImages.length > 0) {
    const combined = product.images.length + uploadedImages.length;
    if (combined > 7) {
      return next(
        new AppError(
          `Cannot add ${uploadedImages.length} image(s): product already has ${product.images.length} (max 7 total).`,
          400
        )
      );
    }
    const newImages = uploadedImages.map((img, index) => ({
      url: img.url,
      publicId: img.publicId,
      alt: `${req.body.name || product.name} - Image ${index + 1}`,
    }));
    updateData.images = [...product.images, ...newImages];
  }

  if (req.body.isFeatured !== undefined) {
    updateData.isFeatured = req.body.isFeatured === 'true' || req.body.isFeatured === true;
  }
  if (req.body.isActive !== undefined) {
    updateData.isActive = req.body.isActive !== 'false' && req.body.isActive !== false;
  }

  if (req.body.variants && typeof req.body.variants === 'string') {
    updateData.variants = safeJsonParse(req.body.variants, req.body.variants, 'variants');
  }
  if (req.body.tags && typeof req.body.tags === 'string') {
    updateData.tags = safeJsonParse(req.body.tags, req.body.tags, 'tags');
  }
  if (req.body.giftOccasions !== undefined) {
    updateData.giftOccasions = safeJsonParse(
      req.body.giftOccasions,
      req.body.giftOccasions,
      'giftOccasions'
    );
  }
  if (req.body.customFields !== undefined) {
    updateData.customFields = safeJsonParse(
      req.body.customFields,
      req.body.customFields,
      'customFields'
    );
  }
  if (req.body.productDetails !== undefined) {
    updateData.productDetails = safeJsonParse(
      req.body.productDetails,
      req.body.productDetails,
      'productDetails'
    );
  }
  if (req.body.isGiftable !== undefined) {
    updateData.isGiftable = req.body.isGiftable === 'true' || req.body.isGiftable === true;
  }
  if (req.body.minOrderQty !== undefined) {
    updateData.minOrderQty = Number(req.body.minOrderQty);
  }

  delete updateData.totalStock;
  
  // Apply all updates natively to the model via product.set() for Mongoose pre('save') triggers (e.g. slug generation)
  product.set(updateData);
  await product.save();

  sendSuccess(res, { product: jsonProduct(product) }, 'Product updated');
});

export const deleteProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new AppError('No product found with that ID.', 404));

  const publicIds = product.images.map((img) => img.publicId);
  await deleteMultipleImages(publicIds);

  await Product.findByIdAndDelete(req.params.id);

  res.status(204).end();
});

export const deleteProductImage = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const rawParam = req.params.publicId;
  const decodedId = decodeURIComponent(rawParam);
  const product = await Product.findById(id);
  if (!product) return next(new AppError('No product found with that ID.', 404));

  if (product.images.length <= 1) {
    return next(new AppError('Product must have at least one image.', 400));
  }

  const match = product.images.find(
    (img) => img.publicId === decodedId || img.publicId === rawParam
  );
  if (!match) {
    return next(new AppError('Image not found on this product.', 404));
  }

  await deleteMultipleImages([match.publicId]);
  product.images = product.images.filter((img) => img.publicId !== match.publicId);
  await product.save();

  sendSuccess(res, { product: jsonProduct(product) });
});

export const getFilterOptions = catchAsync(async (_req: Request, res: Response) => {
  const [categories, fabrics, priceRange] = await Promise.all([
    Product.distinct('category', { isActive: true, category: { $ne: 'Gifting' } }),
    Product.distinct('fabric', { isActive: true, category: { $ne: 'Gifting' } }),
    Product.aggregate([
      { $match: { isActive: true, category: { $ne: 'Gifting' } } },
      { $group: { _id: null, minPrice: { $min: '$price' }, maxPrice: { $max: '$price' } } },
    ]),
  ]);

  sendSuccess(res, {
    categories,
    fabrics: fabrics.filter(Boolean),
    priceRange: priceRange[0] || { minPrice: 0, maxPrice: 100000 },
  });
});
