import assert from "node:assert/strict";
import { multiBuyProductTotal, multiBuySubtotal, priceMultiBuyItems } from "../lib/multi-buy.ts";

assert.equal(multiBuyProductTotal(300_000, 1), 300_000);
assert.equal(multiBuyProductTotal(300_000, 2), 570_000);

const mixedVariants = priceMultiBuyItems([
  { productId: 1, quantity: 1, unitPriceCents: 300_000, size: "2 ans" },
  { productId: 1, quantity: 1, unitPriceCents: 300_000, size: "3 ans" },
]);
assert.deepEqual(mixedVariants.map((item) => item.unitPriceCents), [285_000, 285_000]);
assert.equal(multiBuySubtotal([
  { productId: 1, quantity: 1, unitPriceCents: 300_000 },
  { productId: 1, quantity: 1, unitPriceCents: 300_000 },
]), 570_000);

assert.equal(multiBuySubtotal([
  { productId: 1, quantity: 1, unitPriceCents: 300_000 },
  { productId: 2, quantity: 1, unitPriceCents: 300_000 },
]), 600_000);

console.log("Multi-buy pricing tests passed.");
