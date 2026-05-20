/**
 * Future-ready coupon stacking architecture.
 * Current production behavior: single coupon per cart/checkout (unchanged).
 */
export type CouponStackPolicy = 'single' | 'best_discount' | 'sequential';

export interface CouponStackSlot {
  couponId: string;
  code: string;
  discount: number;
  priority: number;
}

export interface CouponStackResult {
  policy: CouponStackPolicy;
  slots: CouponStackSlot[];
  totalDiscount: number;
}

export const DEFAULT_STACK_POLICY: CouponStackPolicy = 'single';

export function applyStackPolicy(
  candidates: CouponStackSlot[],
  policy: CouponStackPolicy = DEFAULT_STACK_POLICY
): CouponStackResult {
  if (policy === 'single' || candidates.length <= 1) {
    const best = candidates[0];
    return {
      policy: 'single',
      slots: best ? [best] : [],
      totalDiscount: best?.discount ?? 0,
    };
  }
  if (policy === 'best_discount') {
    const best = [...candidates].sort((a, b) => b.discount - a.discount)[0];
    return { policy, slots: best ? [best] : [], totalDiscount: best?.discount ?? 0 };
  }
  const totalDiscount = candidates.reduce((s, c) => s + c.discount, 0);
  return { policy, slots: candidates, totalDiscount };
}
