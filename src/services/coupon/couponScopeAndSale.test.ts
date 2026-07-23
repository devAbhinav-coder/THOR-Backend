import assert from 'node:assert/strict';
import {
  calculateCouponDiscount,
  computeEligibleSubtotal,
  evaluateCouponValidity,
  lineMatchesCouponScope,
  linesScopeFingerprint,
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

// Name fallback: category-scoped coupon matches subcategory with same display name
assert.equal(
  lineMatchesCouponScope(
    baseCoupon({
      scopeType: 'categories',
      applicableCategoryIds: ['cat-chanderi'],
      applicableCategories: ['Chanderi'],
    }),
    { productId: 'p3', categoryId: 'c-sarees', subcategoryId: 's-ch', subcategoryName: 'Chanderi', lineTotal: 800 },
  ),
  true
);

// Fingerprint changes with product composition (not just line count)
{
  const a = linesScopeFingerprint([
    { productId: 'p1', categoryId: 'c1', lineTotal: 1000 },
    { productId: 'p2', categoryId: 'c2', lineTotal: 500 },
  ]);
  const b = linesScopeFingerprint([
    { productId: 'p1', categoryId: 'c1', lineTotal: 1000 },
    { productId: 'p9', categoryId: 'c9', lineTotal: 500 },
  ]);
  const c = linesScopeFingerprint([
    { productId: 'p2', categoryId: 'c2', lineTotal: 500 },
    { productId: 'p1', categoryId: 'c1', lineTotal: 1000 },
  ]);
  assert.ok(a);
  assert.notEqual(a, b);
  assert.equal(a, c);
}

// Direct price: eligible pays exactly discountValue (scope=all / no lines)
{
  const coupon = baseCoupon({ discountType: 'fixed', discountValue: 1150 });
  assert.equal(calculateCouponDiscount(coupon, 2000), 850);
  assert.equal(calculateCouponDiscount(coupon, 1150), 0);
  assert.equal(calculateCouponDiscount(coupon, 900), 0);

  const ok = evaluateCouponValidity(coupon, 'u1', 2000, {
    completedOrders: 0,
    now,
    lines: [{ productId: 'p1', categoryId: 'c1', unitPrice: 2000, quantity: 1, lineTotal: 2000 }],
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.eligibleAmount, 2000);

  const tooLow = evaluateCouponValidity(coupon, 'u1', 900, {
    completedOrders: 0,
    now,
    lines: [{ productId: 'p1', categoryId: 'c1', unitPrice: 900, quantity: 1, lineTotal: 900 }],
  });
  assert.equal(tooLow.valid, false);
  assert.match(String(tooLow.message), /more than/i);
}

// Scoped Direct Price is PER UNIT (not whole eligible cart at ₹1150)
{
  const coupon = baseCoupon({
    discountType: 'fixed',
    discountValue: 1150,
    scopeType: 'subcategories',
    applicableSubcategoryIds: ['s1'],
  });
  const scopedLines: CouponLineScope[] = [
    { productId: 'p1', categoryId: 'c1', subcategoryId: 's1', unitPrice: 2000, quantity: 1, lineTotal: 2000 },
    { productId: 'p2', categoryId: 'c1', subcategoryId: 's1', unitPrice: 3000, quantity: 2, lineTotal: 6000 },
    { productId: 'p3', categoryId: 'c2', subcategoryId: 's2', unitPrice: 5000, quantity: 1, lineTotal: 5000 },
  ];
  // p1: 850, p2: 2*(3000-1150)=3700 → 4550 (p3 out of scope)
  assert.equal(calculateCouponDiscount(coupon, 8000, scopedLines), 4550);

  const validity = evaluateCouponValidity(coupon, 'u1', 13000, {
    completedOrders: 0,
    now,
    lines: scopedLines,
  });
  assert.equal(validity.valid, true);
  assert.equal(validity.eligibleAmount, 8000);

  // Single item already at/below Direct Price → not eligible
  const below = evaluateCouponValidity(coupon, 'u1', 1000, {
    completedOrders: 0,
    now,
    lines: [
      {
        productId: 'p1',
        subcategoryId: 's1',
        unitPrice: 1000,
        quantity: 1,
        lineTotal: 1000,
      },
    ],
  });
  assert.equal(below.valid, false);
  assert.match(String(below.message), /priced above/i);
}

// Scoped Direct Price uses eligible lines only (legacy cart-level when lines omitted)
{
  const coupon = baseCoupon({
    discountType: 'fixed',
    discountValue: 800,
    scopeType: 'categories',
    applicableCategoryIds: ['c1'],
  });
  // With lines: per-unit on c1 line only (1000 → 200 off)
  assert.equal(
    calculateCouponDiscount(coupon, 1000, [
      { productId: 'p1', categoryId: 'c1', subcategoryId: 's1', unitPrice: 1000, quantity: 1, lineTotal: 1000 },
    ]),
    200
  );
  const validity = evaluateCouponValidity(coupon, 'u1', 1500, {
    completedOrders: 0,
    now,
    lines,
  });
  assert.equal(validity.valid, true);
  assert.equal(validity.eligibleAmount, 1000);
}

// Subcategory name fallback
assert.equal(
  lineMatchesCouponScope(
    baseCoupon({
      scopeType: 'subcategories',
      applicableSubcategoryIds: ['s-missing'],
      applicableSubcategoryNames: ['Chanderi'],
    }),
    {
      productId: 'p3',
      categoryId: 'c-sarees',
      subcategoryId: 's-ch',
      subcategoryName: 'Chanderi',
      lineTotal: 800,
    },
  ),
  true
);

console.log('couponBusinessRules + salePriceService tests passed');
