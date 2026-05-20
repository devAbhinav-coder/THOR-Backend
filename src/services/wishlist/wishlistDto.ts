import { Types } from 'mongoose';

type RawProduct = {
  _id: Types.ObjectId | string;
  name?: string;
  slug?: string;
  images?: unknown[];
  price?: number;
  comparePrice?: number;
  ratings?: { average?: number; count?: number };
  category?: string;
  isActive?: boolean;
  totalStock?: number;
  variants?: { stock?: number }[];
};

export type WishlistProductDto = Record<string, unknown> & {
  _id: string;
  inStock: boolean;
  isAvailable: boolean;
  availabilityStatus: 'in_stock' | 'out_of_stock' | 'unavailable';
};

function resolveTotalStock(product: RawProduct): number {
  if (typeof product.totalStock === 'number') return product.totalStock;
  const variants = product.variants || [];
  return variants.reduce((sum, v) => sum + (v.stock ?? 0), 0);
}

/**
 * Serialize a product for wishlist responses.
 * Preserves legacy fields; adds inventory hints for frontend UX without breaking contracts.
 */
export function serializeWishlistProduct(product: RawProduct): WishlistProductDto {
  const stock = resolveTotalStock(product);
  const isActive = product.isActive !== false;
  const inStock = stock > 0;
  const isAvailable = isActive && inStock;
  const availabilityStatus: WishlistProductDto['availabilityStatus'] =
    !isActive ? 'unavailable'
    : inStock ? 'in_stock'
    : 'out_of_stock';

  return {
    ...product,
    _id: String(product._id),
    inStock,
    isAvailable,
    availabilityStatus,
  };
}

export function serializeWishlistProducts(products: RawProduct[]): WishlistProductDto[] {
  return products.map(serializeWishlistProduct);
}
