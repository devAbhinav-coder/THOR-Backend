import mongoose from 'mongoose';
import Testimonial, { ITestimonial } from '../models/Testimonial';
import Review from '../models/Review';
import AppError from '../types/utils/AppError';
import { getCache, setCache, deleteCache } from './cacheService';
import { PUBLIC_REVIEW_FILTER } from './reviews/reviewConstants';

const PUBLIC_CACHE_KEY = 'cache:testimonials:home:v3';
const PUBLIC_TTL = 300;
const QUERY_MAX_MS = 5000;
const MAX_IMAGES = 5;
const HOME_LIMIT = 40;
const MIN_HOME_RATING = 3;

type PopulatedProduct = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  slug?: string;
  images?: { url?: string }[];
  isActive?: boolean;
};

export type HomeStoryDto = {
  _id: string;
  displayName: string;
  isAnonymous: boolean;
  quote: string;
  rating: number;
  images: { url: string }[];
  product?: {
    _id: string;
    name: string;
    slug?: string;
    image?: string;
  };
  sortOrder: number;
  createdAt?: Date;
  sourceKind: 'story' | 'review';
};

export type TestimonialInput = {
  displayName?: string;
  isAnonymous?: boolean;
  quote: string;
  rating?: number;
  isActive?: boolean;
  showOnHome?: boolean;
  sortOrder?: number;
  images?: { url: string; publicId: string }[];
  status?: 'pending' | 'approved' | 'rejected';
  source?: 'public_link' | 'admin';
  productId?: string;
};

function productDto(product: unknown) {
  if (!product || typeof product !== 'object') return undefined;
  const p = product as PopulatedProduct;
  if (!p._id) return undefined;
  if (p.isActive === false) return undefined;
  const image = p.images?.[0]?.url;
  return {
    _id: String(p._id),
    name: String(p.name || 'Product').trim(),
    slug: p.slug ? String(p.slug) : undefined,
    image: image || undefined,
  };
}

function toPublicDto(doc: ITestimonial | Record<string, unknown>): HomeStoryDto {
  const d = doc as ITestimonial & { product?: unknown };
  const anonymous = Boolean(d.isAnonymous) || !String(d.displayName || '').trim();
  const product = productDto(d.product);
  const images = (d.images || [])
    .map((img) => ({ url: img.url }))
    .filter((img) => Boolean(img.url));
  return {
    _id: String(d._id),
    displayName: anonymous ? 'Anonymous' : String(d.displayName).trim(),
    isAnonymous: anonymous,
    quote: d.quote,
    rating: d.rating ?? 5,
    images,
    ...(product ? { product } : {}),
    sortOrder: d.sortOrder ?? 0,
    createdAt: d.createdAt,
    sourceKind: 'story',
  };
}

function reviewToHomeDto(doc: Record<string, unknown>): HomeStoryDto | null {
  const rating = Number(doc.rating) || 0;
  if (rating < MIN_HOME_RATING) return null;

  const images = Array.isArray(doc.images)
    ? (doc.images as { url?: string }[])
        .map((img) => ({ url: String(img?.url || '') }))
        .filter((img) => img.url.length > 0)
    : [];
  if (images.length === 0) return null;

  const quote = String(doc.comment || doc.title || '').trim();
  if (quote.length < 8) return null;

  const snapshot = doc.userSnapshot as { name?: string } | undefined;
  const user =
    doc.user && typeof doc.user === 'object'
      ? (doc.user as { name?: string })
      : undefined;
  const rawName = String(user?.name || snapshot?.name || '').trim();
  const anonymous = !rawName || /^anonymous$/i.test(rawName);

  const product = productDto(doc.product);

  return {
    _id: `review_${String(doc._id)}`,
    displayName: anonymous ? 'Anonymous' : rawName.slice(0, 80),
    isAnonymous: anonymous,
    quote: quote.slice(0, 1200),
    rating,
    images: images.slice(0, MAX_IMAGES),
    ...(product ? { product } : {}),
    sortOrder: 1000,
    createdAt: doc.createdAt as Date | undefined,
    sourceKind: 'review',
  };
}

function toAdminDto(doc: ITestimonial | Record<string, unknown>) {
  const d = doc as ITestimonial & { product?: unknown };
  const status = d.status || (d.isActive ? 'approved' : 'pending');
  const product = productDto(d.product);
  const rawProductId =
    d.product && typeof d.product === 'object' && '_id' in (d.product as object)
      ? String((d.product as PopulatedProduct)._id)
      : d.product
        ? String(d.product)
        : undefined;
  return {
    _id: String(d._id),
    displayName: d.displayName || '',
    isAnonymous: Boolean(d.isAnonymous),
    quote: d.quote,
    rating: d.rating ?? 5,
    images: d.images || [],
    status,
    source: d.source || 'admin',
    isActive: d.isActive !== false && status === 'approved',
    showOnHome: d.showOnHome !== false && status === 'approved',
    sortOrder: d.sortOrder ?? 0,
    ...(product
      ? { product }
      : rawProductId
        ? { product: { _id: rawProductId, name: 'Product' } }
        : {}),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function normalizeProductId(productId?: string) {
  const id = String(productId || '').trim();
  if (!id) return undefined;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid product.', 400);
  }
  return id;
}

export const testimonialService = {
  /**
   * Homepage feed: approved stories + visible product reviews
   * (3+ stars, with photos). Product shown when linked.
   */
  async listPublicForHome() {
    const cached = await getCache<HomeStoryDto[]>(PUBLIC_CACHE_KEY);
    if (cached) return cached;

    const [storyDocs, reviewDocs] = await Promise.all([
      Testimonial.find({
        status: 'approved',
        isActive: true,
        showOnHome: true,
        rating: { $gte: MIN_HOME_RATING },
        'images.0': { $exists: true },
      })
        .populate({ path: 'product', select: 'name slug images isActive' })
        .sort({ sortOrder: 1, createdAt: -1 })
        .limit(HOME_LIMIT)
        .maxTimeMS(QUERY_MAX_MS)
        .lean(),
      Review.find({
        rating: { $gte: MIN_HOME_RATING },
        'images.0': { $exists: true },
        ...PUBLIC_REVIEW_FILTER,
      })
        .sort({ createdAt: -1 })
        .limit(HOME_LIMIT)
        .select('rating title comment images createdAt user userSnapshot product')
        .populate('user', 'name')
        .populate('product', 'name slug images isActive')
        .maxTimeMS(QUERY_MAX_MS)
        .lean(),
    ]);

    const stories = storyDocs
      .map((d) => toPublicDto(d as unknown as ITestimonial))
      .filter((s) => s.images.length > 0 && s.rating >= MIN_HOME_RATING);

    const fromReviews = reviewDocs
      .map((d) => reviewToHomeDto(d as unknown as Record<string, unknown>))
      .filter((s): s is HomeStoryDto => Boolean(s));

    const seenQuotes = new Set<string>();
    const merged: HomeStoryDto[] = [];
    for (const item of [...stories, ...fromReviews]) {
      const key = item.quote.trim().toLowerCase().slice(0, 80);
      if (seenQuotes.has(key)) continue;
      seenQuotes.add(key);
      merged.push(item);
      if (merged.length >= HOME_LIMIT) break;
    }

    await setCache(PUBLIC_CACHE_KEY, merged, PUBLIC_TTL);
    return merged;
  },

  async listAdmin() {
    const docs = await Testimonial.find()
      .populate({ path: 'product', select: 'name slug images isActive' })
      .sort({ createdAt: -1 })
      .maxTimeMS(QUERY_MAX_MS)
      .lean();
    return docs.map((d) => toAdminDto(d as unknown as ITestimonial));
  },

  async create(input: TestimonialInput) {
    const quote = String(input.quote || '').trim();
    if (quote.length < 10) throw new AppError('Quote must be at least 10 characters.', 400);

    const images = (input.images || []).slice(0, MAX_IMAGES);
    const isAnonymous = input.isAnonymous === true || !String(input.displayName || '').trim();
    const source = input.source || 'admin';
    const status = input.status || (source === 'public_link' ? 'pending' : 'approved');
    const approved = status === 'approved';
    const productId = normalizeProductId(input.productId);

    const doc = await Testimonial.create({
      displayName: isAnonymous ? undefined : String(input.displayName).trim(),
      isAnonymous,
      quote,
      rating: Math.min(5, Math.max(1, Number(input.rating) || 5)),
      images,
      ...(productId ? { product: productId } : {}),
      status,
      source,
      isActive: approved && input.isActive !== false,
      showOnHome: approved && input.showOnHome !== false,
      sortOrder: Number(input.sortOrder) || 0,
    });

    await deleteCache(PUBLIC_CACHE_KEY);
    const populated = await Testimonial.findById(doc._id)
      .populate({ path: 'product', select: 'name slug images isActive' })
      .lean();
    return toAdminDto((populated || doc) as unknown as ITestimonial);
  },

  async submitFromPublicLink(input: {
    displayName?: string;
    isAnonymous?: boolean;
    quote: string;
    rating?: number;
    images?: { url: string; publicId: string }[];
    productId?: string;
  }) {
    if (!input.images?.length) {
      throw new AppError('Please upload at least one photo.', 400);
    }
    return this.create({
      ...input,
      source: 'public_link',
      status: 'pending',
      isActive: false,
      showOnHome: false,
    });
  },

  async approve(id: string) {
    const existing = await Testimonial.findById(id);
    if (!existing) throw new AppError('Testimonial not found.', 404);
    existing.status = 'approved';
    existing.isActive = true;
    existing.showOnHome = true;
    await existing.save();
    await deleteCache(PUBLIC_CACHE_KEY);
    return toAdminDto(existing);
  },

  async reject(id: string) {
    const existing = await Testimonial.findById(id);
    if (!existing) throw new AppError('Testimonial not found.', 404);
    existing.status = 'rejected';
    existing.isActive = false;
    existing.showOnHome = false;
    await existing.save();
    await deleteCache(PUBLIC_CACHE_KEY);
    return toAdminDto(existing);
  },

  async update(id: string, input: Partial<TestimonialInput>) {
    const existing = await Testimonial.findById(id);
    if (!existing) throw new AppError('Testimonial not found.', 404);

    if (input.quote !== undefined) {
      const quote = String(input.quote).trim();
      if (quote.length < 10) throw new AppError('Quote must be at least 10 characters.', 400);
      existing.quote = quote;
    }
    if (input.rating !== undefined) {
      existing.rating = Math.min(5, Math.max(1, Number(input.rating) || 5));
    }
    if (input.status !== undefined) {
      existing.status = input.status;
      if (input.status === 'approved') {
        existing.isActive = true;
        existing.showOnHome = true;
      }
      if (input.status === 'rejected' || input.status === 'pending') {
        existing.isActive = false;
        existing.showOnHome = false;
      }
    }
    if (input.isActive !== undefined) existing.isActive = Boolean(input.isActive);
    if (input.showOnHome !== undefined) existing.showOnHome = Boolean(input.showOnHome);
    if (input.sortOrder !== undefined) existing.sortOrder = Number(input.sortOrder) || 0;
    if (input.images !== undefined) {
      existing.images = (input.images || []).slice(0, MAX_IMAGES) as typeof existing.images;
    }
    if (input.productId !== undefined) {
      const productId = normalizeProductId(input.productId);
      existing.product = productId
        ? (new mongoose.Types.ObjectId(productId) as ITestimonial['product'])
        : undefined;
    }
    if (input.isAnonymous !== undefined || input.displayName !== undefined) {
      const isAnonymous =
        input.isAnonymous === true ||
        (input.isAnonymous !== false &&
          !String(input.displayName ?? existing.displayName ?? '').trim());
      existing.isAnonymous = isAnonymous;
      existing.displayName = isAnonymous
        ? undefined
        : String(input.displayName ?? existing.displayName ?? '').trim();
    }

    await existing.save();
    await deleteCache(PUBLIC_CACHE_KEY);
    const populated = await Testimonial.findById(existing._id)
      .populate({ path: 'product', select: 'name slug images isActive' })
      .lean();
    return toAdminDto((populated || existing) as unknown as ITestimonial);
  },

  async remove(id: string) {
    const doc = await Testimonial.findByIdAndDelete(id);
    if (!doc) throw new AppError('Testimonial not found.', 404);
    await deleteCache(PUBLIC_CACHE_KEY);
  },
};
