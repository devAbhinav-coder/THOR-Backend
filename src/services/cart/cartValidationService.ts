import mongoose from "mongoose";
import Coupon from "../../models/Coupon";
import AppError from "../../types/utils/AppError";
import { safeJsonParse } from "../../types/utils/safeJson";
import { CART_QUERY_MAX_MS, COUPON_LOOKUP_SELECT } from "./cartConstants";
import type { CartProductRecord } from "./cartProductService";
import type { CartDto } from "./cartDto";

export type NormalizedCustomFieldAnswer = { label: string; value: string };

export function normalizeCustomFieldAnswers(
  raw: unknown,
): NormalizedCustomFieldAnswer[] {
  const parsed = safeJsonParse<NormalizedCustomFieldAnswer[]>(
    raw,
    [],
    "customFieldAnswers",
  );
  return parsed.map((a) => ({
    label: String(a.label).trim().slice(0, 120),
    value: String(a.value).trim().slice(0, 500),
  }));
}

export function getGiftMinQtyFromRecord(product: CartProductRecord): number {
  const isCorporateGift = ((product.giftOccasions as string[]) || []).some(
    (o) => String(o).trim().toLowerCase() === "corporate",
  );
  const baseMin = Math.max(Number(product.minOrderQty || 1), 1);
  return isCorporateGift ? Math.max(baseMin, 10) : baseMin;
}

export function assertProductAvailableForCart(
  product: CartProductRecord,
): void {
  if (!product.isActive) {
    throw new AppError("Product not found or unavailable.", 404);
  }
}

export function validateCustomFields(
  product: CartProductRecord,
  answers: NormalizedCustomFieldAnswer[],
): void {
  const customFields =
    (product.customFields as { label: string; isRequired: boolean }[]) || [];
  for (const field of customFields) {
    if (!field.isRequired) continue;
    const answer = answers.find((a) => a.label === field.label);
    if (!answer?.value) {
      throw new AppError(`Custom field "${field.label}" is required.`, 400);
    }
  }
}

export function resolveVariantForCart(
  product: CartProductRecord,
  variantSku: string,
): {
  sku: string;
  size?: string;
  color?: string;
  colorCode?: string;
  price?: number;
  stock: number;
} {
  const variants =
    (product.variants as {
      sku: string;
      size?: string;
      color?: string;
      colorCode?: string;
      price?: number;
      stock: number;
    }[]) || [];
  const variant = variants.find((v) => v.sku === variantSku);
  if (!variant) {
    throw new AppError("Selected variant not found.", 404);
  }
  if (variant.stock < 1) {
    throw new AppError("This item is currently out of stock.", 400);
  }
  return variant;
}

export function assertMinQuantity(
  product: CartProductRecord | null,
  quantity: number,
  productName?: string,
): void {
  if (!product) return;
  const minQty = getGiftMinQtyFromRecord(product);
  if (quantity < minQty) {
    const label = productName ? `"${productName}"` : "this item";
    throw new AppError(
      `Minimum order quantity for ${label} is ${minQty}.`,
      400,
    );
  }
}

export function assertCartItemExists(cart: CartDto, cartItemId: string) {
  const item = cart.items.find((i) => i.cartItemId === cartItemId);
  if (!item) {
    throw new AppError("Item not found in cart.", 404);
  }
  return item;
}

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function findCouponByCode(
  code: string,
): Promise<Record<string, unknown> | null> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  return Coupon.findOne({ code: normalized })
    .select(COUPON_LOOKUP_SELECT)
    .maxTimeMS(CART_QUERY_MAX_MS)
    .lean<Record<string, unknown>>();
}

export function assertNonEmptyCart(cart: CartDto): void {
  if (!cart.items?.length) {
    throw new AppError("Your cart is empty.", 400);
  }
}

export function assertCouponAppliedToCart(
  cart: CartDto,
  expectedCode: string,
): void {
  const coupon = cart.coupon;
  if (!coupon || typeof coupon !== "object" || !("code" in coupon)) {
    throw new AppError("Coupon is not valid for this cart.", 400);
  }
  if (
    String((coupon as { code?: string }).code).toUpperCase() !==
    expectedCode.toUpperCase()
  ) {
    throw new AppError("Coupon is not valid for this cart.", 400);
  }
}

export function assertValidObjectId(id: string, label: string): void {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}.`, 400);
  }
}
