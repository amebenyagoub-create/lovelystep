import assert from "node:assert/strict";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS,
  hasFreeShipping,
  parseFreeShippingThresholdDzd,
  shippingAfterPromotion,
} from "../lib/free-shipping.ts";

assert.equal(DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS, 1_200_000);
assert.equal(parseFreeShippingThresholdDzd(undefined), 1_200_000);
assert.equal(parseFreeShippingThresholdDzd(""), 1_200_000);
assert.equal(parseFreeShippingThresholdDzd("incorrect"), 1_200_000);
assert.equal(parseFreeShippingThresholdDzd("-5"), 1_200_000);
assert.equal(parseFreeShippingThresholdDzd("15000"), 1_500_000);

assert.equal(hasFreeShipping(1_199_999, 1_200_000), false);
assert.equal(hasFreeShipping(1_200_000, 1_200_000), true);
assert.equal(hasFreeShipping(1_500_000, 1_200_000), true);

assert.equal(shippingAfterPromotion(1_199_999, 80_000, 1_200_000), 80_000);
assert.equal(shippingAfterPromotion(1_200_000, 80_000, 1_200_000), 0);
assert.equal(shippingAfterPromotion(1_500_000, 80_000, 1_200_000), 0);

console.log(JSON.stringify({ ok: true, checks: 12, thresholdDzd: DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS / 100 }, null, 2));
