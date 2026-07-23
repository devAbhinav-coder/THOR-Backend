import assert from 'node:assert/strict';
import {
  calculateCouponDiscount,
  computeEligibleSubtotal,
  evaluateCouponValidity,
  lineMatchesCouponScope,
  resolveDiscountBaseAmount,
  type CouponLike,
  type CouponLineScope,
} from './couponBusinessRules';
import {
  applyCampaignDiscount,
  campaignMatchesProduct,
  resolveEffectivePrice,
  type SaleCampaignLike,
} from '../sale/salePriceService';

const now = new Date('2026-07-01T12:00:00.000Z');

function baseCoupon(overrides: Partial<CouponLike> = {}): CouponLike {
  return {
    code: 'SAVE10',
    discountType: 'percentage',
    discountValue: 10,
    usedCount: 0,
    userUsageLimit: 5,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    expiryDate: new Date('2026-12-31T00:00:00.000Z'),
    isActive: true,
    scopeType: 'all',
    ...overrides,
  };
}

const lines: CouponLineScope[] = [
  { productId: 'p1', categoryId: 'c1', subcategoryId: 's1', lineTotal: 1000 },
  { productId: 'p2', categoryId: 'c2', subcategoryId: 's2', lineTotal: 500 },
];

// Scope matching
assert.equal(lineMatchesCouponScope(baseCoupon({ scopeType: 'all' }), lines[0]), true);
assert.equal(
  lineMatchesCouponScope(
    baseCoupon({ scopeType: 'categories', applicableCategoryIds: ['c1'] }),
    lines[0]
  ),
  true
);
assert.equal(
  lineMatchesCouponScope(
    baseCoupon({ scopeType: 'categories', applicableCategoryIds: ['c1'] }),
    lines[1]
  ),
  false
);
assert.equal(
  lineMatchesCouponScope(
    baseCoupon({ scopeType: 'products', applicableProductIds: ['p2'] }),
    lines[1]
  ),
  true
);

// Eligible subtotal for category scope
{
  const coupon = baseCoupon({
    scopeType: 'categories',
    applicableCategoryIds: ['c1'],
  });
  const { eligibleSubtotal, matchedLineCount } = computeEligibleSubtotal(coupon, lines);
  assert.equal(eligibleSubtotal, 1000);
  assert.equal(matchedLineCount, 1);
  assert.equal(calculateCouponDiscount(coupon, eligibleSubtotal), 100);
}

// Reject when no matching lines
{
  const coupon = baseCoupon({
    scopeType: 'products',
    applicableProductIds: ['px'],
    minOrderAmount: 0,
  });
  const base = resolveDiscountBaseAmount(coupon, 1500, lines);
  assert.equal(base.amount, 0);
  assert.ok(base.message);

  const validity = evaluateCouponValidity(coupon, 'u1', 1500, {
    completedOrders: 0,
    now,
    lines,
  });
  assert.equal(validity.valid, false);
}

// Min order against eligible amount only
{
  const coupon = baseCoupon({
    scopeType: 'categories',
    applicableCategoryIds: ['c1'],
    minOrderAmount: 1200,
  });
  const validity = evaluateCouponValidity(coupon, 'u1', 1500, {
    completedOrders: 0,
    now,
    lines,
  });
  assert.equal(validity.valid, false);
  assert.match(String(validity.message), /Minimum order/i);
}

// Sale campaign pricing
{
  const campaign: SaleCampaignLike = {
    _id: 'sale1',
    name: 'Cat Sale',
    discountType: 'percentage',
    discountValue: 20,
    scopeType: 'categories',
    categoryIds: ['c1'],
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-12-31T00:00:00.000Z'),
    isActive: true,
    badgeText: 'Sale',
  };
  assert.equal(campaignMatchesProduct(campaign, { _id: 'p1', price: 1000, categoryId: 'c1' }), true);
  assert.equal(campaignMatchesProduct(campaign, { _id: 'p2', price: 1000, categoryId: 'c2' }), false);
  assert.equal(applyCampaignDiscount(1000, campaign), 800);

  const resolved = resolveEffectivePrice(
    { _id: 'p1', price: 1000, categoryId: 'c1' },
    [campaign],
    now
  );
  assert.equal(resolved.effectivePrice, 800);
  assert.equal(resolved.onSale, true);
  assert.equal(resolved.saleCampaignId, 'sale1');
  assert.equal(resolved.saleBadge, 'Sale');
}

// Best of multiple campaigns
{
  const a: SaleCampaignLike = {
    name: 'A',
    discountType: 'percentage',
    discountValue: 10,
    scopeType: 'all',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    isActive: true,
  };
  const b: SaleCampaignLike = {
    _id: 'better',
    name: 'B',
    discountType: 'percentage',
    discountValue: 25,
    scopeType: 'all',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    isActive: true,
  };
  const resolved = resolveEffectivePrice({ price: 1000 }, [a, b], now);
  assert.equal(resolved.effectivePrice, 750);
  assert.equal(resolved.saleCampaignId, 'better');
}

console.log('couponBusinessRules + salePriceService tests passed');
