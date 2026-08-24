import assert from "node:assert/strict";
import {
  mergeSearchIntentWithFilters,
  parseSearchQueryIntent,
} from "./searchQueryParser";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("corrects cotton typo and detects fabric", () => {
  const intent = parseSearchQueryIntent("rd cootton sar");
  assert.ok(intent.fabrics.includes("cotton"));
  assert.ok(intent.colors.includes("red"));
  assert.ok(intent.categories.includes("saree"));
  assert.ok(intent.didYouMean);
});

test("parses under 5000 price phrase", () => {
  const intent = parseSearchQueryIntent("cotton sare under 5000");
  assert.equal(intent.maxPrice, 5000);
  assert.ok(intent.fabrics.includes("cotton"));
  assert.ok(intent.categories.includes("saree"));
});

test("parses 3k shorthand", () => {
  const intent = parseSearchQueryIntent("silk saree under 3k");
  assert.equal(intent.maxPrice, 3000);
});

test("clean price query is not a did-you-mean", () => {
  const intent = parseSearchQueryIntent("saree under 1500");
  assert.equal(intent.maxPrice, 1500);
  assert.equal(intent.didYouMean, undefined);
});

test("maps sarah typo to saree search text", () => {
  const intent = parseSearchQueryIntent("sarah");
  assert.equal(intent.textQuery, "saree");
  assert.ok(intent.categories.includes("saree"));
});

test("maps silk sare typo to silk saree", () => {
  const intent = parseSearchQueryIntent("silk sare");
  assert.equal(intent.textQuery, "silk saree");
  assert.ok(intent.fabrics.includes("silk"));
});

test("empty query returns empty intent", () => {
  const intent = parseSearchQueryIntent("   ");
  assert.equal(intent.textQuery, "");
  assert.deepEqual(intent.fabrics, []);
});

test("parses chanderi saree intent", () => {
  const intent = parseSearchQueryIntent("chanderi saree");
  assert.ok(intent.fabrics.includes("chanderi"));
  assert.ok(intent.categories.includes("saree"));
});

test("merge puts parsed intent categories into intentCategories (not hard filter)", () => {
  const intent = parseSearchQueryIntent("chanderi saree");
  const merged = mergeSearchIntentWithFilters(intent, {});
  // Chanderi is a fabric
  assert.ok(merged.fabrics.includes("Chanderi"));
  // Saree from the text query goes to intentCategories (soft boost), not the hard filter 'categories'
  assert.ok(merged.intentCategories.includes("Sarees"));
  // No explicit URL categories were passed, so hard filter set should be empty
  assert.equal(merged.categories.length, 0, "No explicit categories should be in hard filter");
});

test("explicit URL filters go to categories, intent-only go to intentCategories", () => {
  const intent = parseSearchQueryIntent("cotton saree");
  const merged = mergeSearchIntentWithFilters(intent, {
    colors: ["Silk"],
    categories: ["Lehengas"],
  });
  // Cotton from text is a fabric, not a color
  assert.ok(merged.fabrics.includes("Cotton"));
  // Silk was an explicit color URL filter
  assert.ok(merged.colors.includes("Silk"));
  // Saree from text query → intentCategories (soft boost only)
  assert.ok(merged.intentCategories.includes("Sarees"));
  // Lehenga was an EXPLICIT URL param → goes to hard-filter categories
  assert.ok(merged.categories.includes("Lehengas"));
  // Saree should NOT be in hard-filter categories (it's text-intent only)
  assert.ok(!merged.categories.includes("Sarees"));
});

test("builds empty residual query when intent fully covers search", () => {
  const intent = parseSearchQueryIntent("chanderi saree");
  const merged = mergeSearchIntentWithFilters(intent, {});
  assert.equal(merged.residualQuery, "");
});

if (require.main === module) {
  console.log("searchQueryParser tests passed");
}
