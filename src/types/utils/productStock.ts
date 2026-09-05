import mongoose from 'mongoose';
import { normalizeCloudinaryDeliveryUrl } from './cloudinaryUrl';

/** Sum of variant.stock — source of truth for sellable quantity (must match cart / checkout). */
export function sumVariantStocks(variants: { stock?: number }[] | undefined): number {
  if (!variants?.length) return 0;
  return variants.reduce((acc, v) => acc + Math.max(0, Math.floor(Number(v.stock) || 0)), 0);
}

type ProductJsonImage = { url?: string; publicId?: string; alt?: string; color?: string };

type VariantLike = Record<string, unknown> & { stock?: number; costPrice?: unknown };

export type ReconcileProductOptions = {
  /**
   * When false (default), strip `variants.costPrice` so storefront/PDP APIs
   * never leak wholesale unit cost. Admin list/detail should pass true.
   */
  includeCostPrice?: boolean;
};

function stripVariantCostPrice<T extends VariantLike>(variant: T): Omit<T, 'costPrice'> {
  const { costPrice: _cost, ...rest } = variant;
  return rest;
}

export function reconcileProductJson<
  T extends { variants?: VariantLike[]; images?: ProductJsonImage[] },
>(json: T, opts?: ReconcileProductOptions): T & { totalStock: number } {
  const includeCost = opts?.includeCostPrice === true;
  const variants =
    json.variants?.map((v) => (includeCost ? v : stripVariantCostPrice(v))) ??
    json.variants;
  const totalStock = sumVariantStocks(variants);
  const out = { ...json, variants, totalStock } as T & { totalStock: number };
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
