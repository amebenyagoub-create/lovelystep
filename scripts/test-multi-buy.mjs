import assert from "node:assert/strict";
import { multiBuySubtotal, priceMultiBuyItems } from "../lib/multi-buy.ts";

const mixedVariants = priceMultiBuyItems([
  { productId: 1, quantity: 1, unitPriceCents: 300_000, size: "2 ans" },
  { productId: 1, quantity: 1, unitPriceCents: 300_000, size: "3 ans" },
]);
assert.deepEqual(mixedVariants.map((item) => item.unitPriceCents), [300_000, 300_000]);
assert.equal(multiBuySubtotal([
  { productId: 1, quantity: 2, unitPriceCents: 300_000 },
]), 600_000);

assert.equal(multiBuySubtotal([
  { productId: 1, quantity: 1, unitPriceCents: 300_000 },
  { productId: 2, quantity: 1, unitPriceCents: 200_000 },
]), 500_000);

assert.equal(multiBuySubtotal([
  { productId: 1, quantity: 1, unitPriceCents: 680_000 },
  { productId: 2, quantity: 1, unitPriceCents: 660_000 },
]), 1_250_000);

assert.equal(multiBuySubtotal([
  { productId: 1, quantity: 1, unitPriceCents: 680_000 },
  { productId: 2, quantity: 1, unitPriceCents: 660_000 },
  { productId: 3, quantity: 1, unitPriceCents: 680_000 },
]), 2_020_000);

console.log("Multi-buy pricing tests passed.");
