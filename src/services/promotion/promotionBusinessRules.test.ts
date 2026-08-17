import assert from 'node:assert/strict';
import {
  calculatePromotionDiscount,
  pickBestPromotion,
  pickPromotionHint,
  promotionDisplayLabel,
  type PromotionLike,
} from './promotionBusinessRules';
import type { CouponLineScope } from '../coupon/couponBusinessRules';

const now = new Date('2026-07-01T12:00:00.000Z');

function basePromo(overrides: Partial<PromotionLike> = {}): PromotionLike {
  return {
    name: 'Test Offer',
    promotionType: 'bogo',
    buyQuantity: 1,
    getQuantity: 1,
    getDiscountPercent: 100,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-12-31T00:00:00.000Z'),
    isActive: true,
    scopeType: 'all',
    ...overrides,
  };
}

// Buy 1 Get 1 — 2 items, cheapest free
{
  const promo = basePromo({ promotionType: 'bogo', buyQuantity: 1, getQuantity: 1 });
  const lines: CouponLineScope[] = [
    { productId: 'p1', lineTotal: 1000, unitPrice: 1000, quantity: 1 },
    { productId: 'p2', lineTotal: 500, unitPrice: 500, quantity: 1 },
  ];
  assert.equal(calculatePromotionDiscount(promo, lines), 500);
  assert.equal(promotionDisplayLabel(promo), 'Buy 1 Get 1 Free');
}

// Buy 2 Get 1 — need 3 units
{
  const promo = basePromo({ promotionType: 'bogo', buyQuantity: 2, getQuantity: 1 });
  const lines: CouponLineScope[] = [
    { productId: 'p1', lineTotal: 1500, unitPrice: 500, quantity: 3 },
  ];
  assert.equal(calculatePromotionDiscount(promo, lines), 500);
}

// Buy 2 Get ₹200 off
{
  const promo = basePromo({
    promotionType: 'flat',
    buyQuantity: 2,
    discountValue: 200,
  });
  const lines: CouponLineScope[] = [
    { productId: 'p1', lineTotal: 1000, unitPrice: 500, quantity: 2 },
  ];
  assert.equal(calculatePromotionDiscount(promo, lines), 200);
  assert.equal(promotionDisplayLabel(promo), 'Buy 2+ · ₹200 off');
}

// Not enough qty
{
  const promo = basePromo({ promotionType: 'flat', buyQuantity: 5, discountValue: 500 });
  const lines: CouponLineScope[] = [
    { productId: 'p1', lineTotal: 1000, unitPrice: 500, quantity: 2 },
  ];
  assert.equal(calculatePromotionDiscount(promo, lines), 0);
}

// Best promotion wins
{
  const promos = [
    basePromo({ _id: 'a', promotionType: 'flat', buyQuantity: 2, discountValue: 100, priority: 0 }),
    basePromo({ _id: 'b', promotionType: 'flat', buyQuantity: 2, discountValue: 200, priority: 0 }),
  ];
  const lines: CouponLineScope[] = [
    { productId: 'p1', lineTotal: 1000, unitPrice: 500, quantity: 2 },
  ];
  const best = pickBestPromotion(promos, lines, now);
  assert.ok(best);
  assert.equal(best.discount, 200);
}

// Hint when close but not unlocked — Buy 2 Get 1 with 2 items
{
  const promo = basePromo({ promotionType: 'bogo', buyQuantity: 2, getQuantity: 1 });
  const lines: CouponLineScope[] = [
    { productId: 'p1', lineTotal: 1000, unitPrice: 500, quantity: 2 },
  ];
  const hint = pickPromotionHint([promo], lines, now);
  assert.ok(hint);
  assert.equal(hint!.label, 'Buy 2 Get 1 Free');
  assert.equal(hint!.message, 'Add 1 more item for Buy 2 Get 1 Free');
}

// No hint when offer already applied
{
  const promo = basePromo({ promotionType: 'bogo', buyQuantity: 2, getQuantity: 1 });
  const lines: CouponLineScope[] = [
    { productId: 'p1', lineTotal: 1500, unitPrice: 500, quantity: 3 },
  ];
  assert.equal(pickPromotionHint([promo], lines, now), null);
}

console.log('promotionBusinessRules tests passed');
