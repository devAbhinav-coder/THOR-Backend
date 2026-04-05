import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import streamifier from 'streamifier';
import { cloudinaryInstance } from '../services/cloudinary';
import AppError from '../utils/AppError';

const memoryStorage = multer.memoryStorage();

const imageFileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new AppError('Only image files are allowed.', 400) as unknown as null, false);
  }
};

export const uploadProductImages = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 12 * 1024 * 1024, files: 7 },
}).array('images', 7);

export const uploadAvatar = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
}).single('avatar');

export const uploadReviewImages = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 3 * 1024 * 1024, files: 3 },
}).array('images', 3);

export const uploadGiftingImages = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 12 * 1024 * 1024, files: 5 },
}).array('images', 5);

export const uploadStorefrontAssets = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
}).any();

interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
}

type CloudinaryUploadOpts = {
  /** Default `auto`. Use a higher value (e.g. 92) for hero assets where clarity matters. */
  quality?: string | number;
};

const uploadToCloudinary = (
  buffer: Buffer,
  folder: string,
  transformation?: object,
  opts?: CloudinaryUploadOpts
): Promise<CloudinaryUploadResult> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinaryInstance.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation,
        quality: opts?.quality ?? 'auto',
        fetch_format: 'auto',
      },
      (error, result) => {
        if (error || !result) {
          return reject(error || new Error('Upload failed'));
        }
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

export const processProductImages = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) return next();

    // PDP + retina: keep long edge generous (portrait 3:4 fits in 2048×2730); `limit` keeps aspect ratio, never upscales.
    const uploadPromises = files.map((file) =>
      uploadToCloudinary(
        file.buffer,
        'house-of-rani/products',
        [{ width: 2048, height: 2730, crop: 'limit' }],
        { quality: 92 }
      )
    );

    const results = await Promise.all(uploadPromises);

    (req as Request & { uploadedImages: { url: string; publicId: string }[] }).uploadedImages =
      results.map((r) => ({ url: r.secure_url, publicId: r.public_id }));

    next();
  } catch (err) {
    next(new AppError('Image upload failed. Please try again.', 500));
  }
};

export const processAvatar = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const file = req.file;
    if (!file) return next();

    const result = await uploadToCloudinary(file.buffer, 'house-of-rani/avatars', [
      { width: 200, height: 200, crop: 'fill', gravity: 'face' },
    ]);

    (req.file as Express.Multer.File & { path: string; filename: string }).path = result.secure_url;
    (req.file as Express.Multer.File & { path: string; filename: string }).filename = result.public_id;

    next();
  } catch (err) {
    next(new AppError('Avatar upload failed.', 500));
  }
};

export const processCategoryImage = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const file = req.file;
    if (!file) return next();

    const result = await uploadToCloudinary(file.buffer, 'house-of-rani/categories', [
      { width: 800, crop: 'limit' },
    ]);

    (req as Request & { uploadedImage?: string }).uploadedImage = result.secure_url;
    next();
  } catch (err) {
    next(new AppError('Category image upload failed.', 500));
  }
};

export const processReviewImages = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) return next();

    const uploadPromises = files.map((file) =>
      uploadToCloudinary(file.buffer, 'house-of-rani/reviews', [
        { width: 600, height: 600, crop: 'limit' },
      ])
    );

    const results = await Promise.all(uploadPromises);

    (req as Request & { uploadedImages: { url: string; publicId: string }[] }).uploadedImages =
      results.map((r) => ({ url: r.secure_url, publicId: r.public_id }));

    next();
  } catch (err) {
    next(new AppError('Review image upload failed.', 500));
  }
};

export const processGiftingImages = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) return next();

    // Same PDP-style limits as catalog products (gift requests + cart custom-field refs).
    const uploadPromises = files.map((file) =>
      uploadToCloudinary(
        file.buffer,
        'house-of-rani/gifting-requests',
        [{ width: 2048, height: 2730, crop: 'limit' }],
        { quality: 92 }
      )
    );

    const results = await Promise.all(uploadPromises);

    (req as Request & { uploadedImages: { url: string; publicId: string }[] }).uploadedImages =
      results.map((r) => ({ url: r.secure_url, publicId: r.public_id }));

    next();
  } catch (err) {
    next(new AppError('Gifting reference image upload failed.', 500));
  }
};

export const processStorefrontAssets = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) return next();

    const uploaded: {
      hero: Record<string, { url: string; publicId: string }>;
      promo?: { url: string; publicId: string };
      blogMain?: { url: string; publicId: string };
      blogSide?: { url: string; publicId: string };
      shopBannerLeft?: { url: string; publicId: string };
      shopBannerCenter?: { url: string; publicId: string };
      shopBannerRight?: { url: string; publicId: string };
      giftingHero: Record<string, { url: string; publicId: string }>;
      giftingSecondary: Record<string, { url: string; publicId: string }>;
      homeGiftCard: Record<string, { url: string; publicId: string }>;
    } = { hero: {}, giftingHero: {}, giftingSecondary: {}, homeGiftCard: {} };

    for (const file of files) {
      if (file.fieldname.startsWith('heroImage_')) {
        const index = file.fieldname.replace('heroImage_', '');
        const result = await uploadToCloudinary(file.buffer, 'house-of-rani/storefront/hero', [
          { width: 1600, height: 900, crop: 'limit' },
        ]);
        uploaded.hero[index] = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname === 'promoBackground') {
        const result = await uploadToCloudinary(file.buffer, 'house-of-rani/storefront/promo', [
          { width: 1600, crop: 'limit' },
        ]);
        uploaded.promo = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname === 'blogMainImage') {
        const result = await uploadToCloudinary(file.buffer, 'house-of-rani/storefront/blog', [
          { width: 1200, crop: 'limit' },
        ]);
        uploaded.blogMain = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname === 'blogSideImage') {
        const result = await uploadToCloudinary(file.buffer, 'house-of-rani/storefront/blog', [
          { width: 800, crop: 'limit' },
        ]);
        uploaded.blogSide = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname === 'shopBannerLeftImage') {
        const result = await uploadToCloudinary(file.buffer, 'house-of-rani/storefront/shop-banner', [
          { width: 900, height: 1200, crop: 'limit' },
        ]);
        uploaded.shopBannerLeft = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname === 'shopBannerCenterImage') {
        const result = await uploadToCloudinary(file.buffer, 'house-of-rani/storefront/shop-banner', [
          { width: 2500, height: 500, crop: 'limit' },
        ]);
        uploaded.shopBannerCenter = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname === 'shopBannerRightImage') {
        const result = await uploadToCloudinary(file.buffer, 'house-of-rani/storefront/shop-banner', [
          { width: 900, height: 1200, crop: 'limit' },
        ]);
        uploaded.shopBannerRight = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname.startsWith('giftingHeroImage_')) {
        const index = file.fieldname.replace('giftingHeroImage_', '');
        const result = await uploadToCloudinary(
          file.buffer,
          'house-of-rani/storefront/gifting-hero',
          [{ width: 1920, height: 1080, crop: 'limit' }],
          { quality: 92 }
        );
        uploaded.giftingHero[index] = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname.startsWith('giftingSecondaryImage_')) {
        const index = file.fieldname.replace('giftingSecondaryImage_', '');
        const result = await uploadToCloudinary(
          file.buffer,
          'house-of-rani/storefront/gifting-secondary',
          [{ width: 2048, crop: 'limit' }],
          { quality: 92 }
        );
        uploaded.giftingSecondary[index] = { url: result.secure_url, publicId: result.public_id };
      } else if (file.fieldname.startsWith('homeGiftCardImage_')) {
        const index = file.fieldname.replace('homeGiftCardImage_', '');
        const result = await uploadToCloudinary(
          file.buffer,
          'house-of-rani/storefront/home-gift-cards',
          [{ width: 800, height: 800, crop: 'limit' }],
          { quality: 90 }
        );
        uploaded.homeGiftCard[index] = { url: result.secure_url, publicId: result.public_id };
      }
    }

    (req as Request & { uploadedStorefrontImages?: typeof uploaded }).uploadedStorefrontImages = uploaded;
    next();
  } catch (err) {
    next(new AppError('Storefront image upload failed.', 500));
  }
};

export const uploadBlogImages = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
}).array('images', 10);

export const processBlogImages = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) return next();

    const uploadPromises = files.map((file) =>
      uploadToCloudinary(file.buffer, 'house-of-rani/blogs', [
        { width: 1200, crop: 'limit' },
      ])
    );

    const results = await Promise.all(uploadPromises);

    (req as Request & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages =
      results.map((r) => ({ url: r.secure_url, publicId: r.public_id }));

    next();
  } catch (err) {
    next(new AppError('Blog image upload failed.', 500));
  }
};
