import mongoose from 'mongoose';
import { normalizeCloudinaryDeliveryUrl } from './cloudinaryUrl';

/** Sum of variant.stock — source of truth for sellable quantity (must match cart / checkout). */
export function sumVariantStocks(variants: { stock?: number }[] | undefined): number {
  if (!variants?.length) return 0;
  return variants.reduce((acc, v) => acc + Math.max(0, Math.floor(Number(v.stock) || 0)), 0);
}

type ProductJsonImage = { url?: string; publicId?: string; alt?: string };

export function reconcileProductJson<
  T extends { variants?: { stock?: number }[]; images?: ProductJsonImage[] },
>(json: T): T & { totalStock: number } {
  const totalStock = sumVariantStocks(json.variants);
  const out = { ...json, totalStock } as T & { totalStock: number };
  if (json.images?.length) {
    out.images = json.images.map((img) => ({
      ...img,
      url: normalizeCloudinaryDeliveryUrl(img.url) || img.url || '',
    }));
  }
  return out;
}

/** Cart / order line: `product` may be ObjectId or populated document. */
export function refProductId(
  ref: mongoose.Types.ObjectId | string | { _id?: mongoose.Types.ObjectId | string } | null | undefined
): string {
  if (ref == null) return '';
  if (typeof ref === 'string') return ref;
  if (ref instanceof mongoose.Types.ObjectId) return ref.toHexString();
  if (typeof ref === 'object' && ref._id != null) {
    const id = ref._id;
    return id instanceof mongoose.Types.ObjectId ? id.toHexString() : String(id);
  }
  return String(ref);
}
