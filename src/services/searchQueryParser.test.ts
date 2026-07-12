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

test("merge applies parsed fabric and category intent as filters", () => {
  const intent = parseSearchQueryIntent("chanderi saree");
  const merged = mergeSearchIntentWithFilters(intent, {});
  assert.ok(merged.fabrics.includes("Chanderi"));
  assert.ok(merged.categories.includes("Sarees"));
});

test("explicit URL filters merge with parsed intent", () => {
  const intent = parseSearchQueryIntent("cotton saree");
  const merged = mergeSearchIntentWithFilters(intent, {
    fabrics: ["Silk"],
    categories: ["Lehengas"],
  });
  assert.ok(merged.fabrics.includes("Cotton"));
  assert.ok(merged.fabrics.includes("Silk"));
  assert.ok(merged.categories.includes("Sarees"));
  assert.ok(merged.categories.includes("Lehengas"));
});

test("builds empty residual query when intent fully covers search", () => {
  const intent = parseSearchQueryIntent("chanderi saree");
  const merged = mergeSearchIntentWithFilters(intent, {});
  assert.equal(merged.residualQuery, "");
});

if (require.main === module) {
  console.log("searchQueryParser tests passed");
}
