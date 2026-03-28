import { Request, Response, NextFunction } from 'express';
import Product from '../models/Product';
import { deleteMultipleImages } from '../services/cloudinary';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import APIFeatures from '../utils/apiFeatures';
import { IProduct } from '../types';
import { reconcileProductJson, sumVariantStocks } from '../utils/productStock';

function jsonProduct(p: { toJSON: () => Record<string, unknown> }) {
  const raw = p.toJSON() as Record<string, unknown> & { variants?: { stock?: number }[] };
  return reconcileProductJson(raw);
}

export const getAllProducts = catchAsync(async (req: Request, res: Response) => {
  const features = new APIFeatures<IProduct>(
    Product.find({ isActive: true }),
    req.query as Record<string, string>
  )
    .filter()
    .search(['name', 'description', 'tags'])
    .sort()
    .limitFields()
    .paginate();

  const [products, totalCount] = await Promise.all([
    features.query,
    Product.countDocuments({ isActive: true }),
  ]);

  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '12', 10);

  res.status(200).json({
    status: 'success',
    results: products.length,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalProducts: totalCount,
      hasNextPage: page * limit < totalCount,
      hasPrevPage: page > 1,
    },
    data: { products: products.map((p) => jsonProduct(p)) },
  });
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

  res.status(200).json({
    status: 'success',
    data: { viewCount: updated.viewCount },
  });
});

export const getProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true });

  if (!product) {
    return next(new AppError('No product found with that slug.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { product: jsonProduct(product) },
  });
});

export const getFeaturedProducts = catchAsync(async (_req: Request, res: Response) => {
  const products = await Product.find({ isFeatured: true, isActive: true })
    .sort('-createdAt')
    .limit(8);

  res.status(200).json({
    status: 'success',
    data: { products: products.map((p) => jsonProduct(p)) },
  });
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
    Product.countDocuments({ category: req.params.category, isActive: true }),
  ]);

  res.status(200).json({
    status: 'success',
    results: products.length,
    total: totalCount,
    data: { products: products.map((p) => jsonProduct(p)) },
  });
});

export const createProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const uploadedImages = (req as Request & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;

  if (!uploadedImages || uploadedImages.length === 0) {
    return next(new AppError('Please upload at least one product image.', 400));
  }

  const images = uploadedImages.map((img, index) => ({
    url: img.url,
    publicId: img.publicId,
    alt: `${req.body.name} - Image ${index + 1}`,
  }));

  const variantsParsed =
    typeof req.body.variants === 'string' ? JSON.parse(req.body.variants) : req.body.variants;

  const productData = {
    ...req.body,
    images,
    variants: variantsParsed,
    tags: typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags,
    price: Number(req.body.price),
    comparePrice: req.body.comparePrice ? Number(req.body.comparePrice) : undefined,
    isFeatured: req.body.isFeatured === 'true' || req.body.isFeatured === true,
    isActive: req.body.isActive !== 'false' && req.body.isActive !== false,
  };
  delete (productData as Record<string, unknown>).totalStock;
  (productData as Record<string, unknown>).totalStock = sumVariantStocks(variantsParsed);

  const product = await Product.create(productData);

  res.status(201).json({
    status: 'success',
    data: { product: jsonProduct(product) },
  });
});

export const updateProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new AppError('No product found with that ID.', 404));

  const updateData: Record<string, unknown> = { ...req.body };

  const uploadedImages = (req as Request & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;
  if (uploadedImages && uploadedImages.length > 0) {
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
    updateData.variants = JSON.parse(req.body.variants);
  }

  delete updateData.totalStock;
  if (updateData.variants) {
    updateData.totalStock = sumVariantStocks(updateData.variants as { stock?: number }[]);
  }

  const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  if (!updatedProduct) {
    return next(new AppError('No product found with that ID.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { product: jsonProduct(updatedProduct) },
  });
});

export const deleteProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new AppError('No product found with that ID.', 404));

  const publicIds = product.images.map((img) => img.publicId);
  await deleteMultipleImages(publicIds);

  await Product.findByIdAndDelete(req.params.id);

  res.status(204).json({ status: 'success', data: null });
});

export const deleteProductImage = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { id, publicId } = req.params;
  const product = await Product.findById(id);
  if (!product) return next(new AppError('No product found with that ID.', 404));

  if (product.images.length <= 1) {
    return next(new AppError('Product must have at least one image.', 400));
  }

  await deleteMultipleImages([publicId]);
  product.images = product.images.filter((img) => img.publicId !== publicId);
  await product.save();

  res.status(200).json({
    status: 'success',
    data: { product: jsonProduct(product) },
  });
});

export const getFilterOptions = catchAsync(async (_req: Request, res: Response) => {
  const [categories, fabrics, priceRange] = await Promise.all([
    Product.distinct('category', { isActive: true }),
    Product.distinct('fabric', { isActive: true }),
    Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, minPrice: { $min: '$price' }, maxPrice: { $max: '$price' } } },
    ]),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      categories,
      fabrics: fabrics.filter(Boolean),
      priceRange: priceRange[0] || { minPrice: 0, maxPrice: 100000 },
    },
  });
});
