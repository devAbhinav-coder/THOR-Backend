import assert from "node:assert/strict";
import {
  catalogMatchKey,
  colorFlexibleRegex,
  dedupeCatalogLabels,
  resolveColorAgainstCatalog,
} from "./catalogAttributes";

assert.equal(catalogMatchKey("Off White"), catalogMatchKey("Offwhite"));
assert.equal(catalogMatchKey("Yellow"), catalogMatchKey("yellow"));
assert.equal(catalogMatchKey("PINK"), catalogMatchKey("Pink"));

const deduped = dedupeCatalogLabels([
  "Off White",
  "Offwhite",
  "Orange",
  "orange",
  "Yellow",
  "Yellow",
  "yellow",
  "PINK",
  "Pink",
  "peach pink",
  "Peach Pink",
]);

assert.ok(deduped.includes("Off White"));
assert.ok(!deduped.some((c: string) => c.toLowerCase() === "offwhite"));
assert.equal(deduped.filter((c: string) => catalogMatchKey(c) === "yellow").length, 1);
assert.equal(deduped.filter((c: string) => catalogMatchKey(c) === "orange").length, 1);
assert.equal(deduped.filter((c: string) => catalogMatchKey(c) === "pink").length, 1);
assert.equal(
  deduped.filter((c: string) => catalogMatchKey(c) === "peachpink").length,
  1,
);
assert.ok(deduped.includes("Mustard Yellow"));
assert.ok(deduped.includes("Peach Pink"));
assert.ok(deduped.includes("Pink"));
assert.ok(!deduped.includes("PINK"));
assert.ok(!deduped.includes("Mustard yellow"));
assert.ok(!deduped.includes("peach pink"));

assert.ok(colorFlexibleRegex("Off White").test("Offwhite"));
assert.ok(colorFlexibleRegex("Offwhite").test("Off White"));
assert.ok(!colorFlexibleRegex("Red").test("Red Wine"));

assert.equal(
  resolveColorAgainstCatalog("offwhite", ["Off White", "Yellow"]),
  "Off White",
);
assert.equal(resolveColorAgainstCatalog("new shade", []), "New Shade");

console.log("catalogAttributes.test.ts: ok");
