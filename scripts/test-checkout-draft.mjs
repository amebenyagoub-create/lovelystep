import assert from "node:assert/strict";
import {
  ABANDONED_REMINDER_DELAY_MINUTES,
  isLikelyAlgerianMobile,
  isValidCheckoutDraftToken,
} from "../lib/checkout-draft.ts";

assert.equal(ABANDONED_REMINDER_DELAY_MINUTES, 45);
for (const phone of ["0550 12 34 56", "+213 550 12 34 56", "661234567", "0770-12-34-56"]) {
  assert.equal(isLikelyAlgerianMobile(phone), true, `expected a valid Algerian mobile: ${phone}`);
}
for (const phone of ["", "021123456", "12345", "+33123456789"]) {
  assert.equal(isLikelyAlgerianMobile(phone), false, `expected an invalid Algerian mobile: ${phone}`);
}
assert.equal(isValidCheckoutDraftToken("b1860410-532f-468f-a870-fd87ff18d0d2"), true);
assert.equal(isValidCheckoutDraftToken("short"), false);
assert.equal(isValidCheckoutDraftToken("unsafe token with spaces 123456"), false);

console.log("checkout draft validation: ok");
