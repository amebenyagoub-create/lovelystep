import assert from "node:assert/strict";
import { easyDealCorsHeaders, easyDealHasFreeShipping, easyDealOfferUnitPriceCents, parseEasyDealOrigins } from "../lib/easydeal.ts";

const testOrigin = "https://easy-deal-dz-test.benameurgoub.chatgpt.site";

assert.deepEqual([...parseEasyDealOrigins(undefined)], [testOrigin]);
assert.deepEqual([...parseEasyDealOrigins("https://shop.example, https://two.example/")], ["https://shop.example", "https://two.example"]);

const allowed = easyDealCorsHeaders(new Request("https://lovelystep.com/api/orders", { headers: { origin: testOrigin } }));
assert.equal(allowed?.get("Access-Control-Allow-Origin"), testOrigin);
assert.match(allowed?.get("Access-Control-Allow-Headers") ?? "", /X-Sales-Channel/);

const denied = easyDealCorsHeaders(new Request("https://lovelystep.com/api/orders", { headers: { origin: "https://evil.example" } }));
assert.equal(denied, null);

const offers = [
  { quantity: 1, priceCents: 175_000, compareAtCents: 350_000, freeShipping: false },
  { quantity: 2, priceCents: 265_000, compareAtCents: 350_000, freeShipping: false },
  { quantity: 3, priceCents: 450_000, compareAtCents: 525_000, freeShipping: true },
];
assert.equal(easyDealOfferUnitPriceCents(offers, 1, 145_000), 175_000);
assert.equal(easyDealOfferUnitPriceCents(offers, 2, 145_000) * 2, 265_000);
assert.equal(easyDealOfferUnitPriceCents(offers, 3, 145_000) * 3, 450_000);
assert.equal(easyDealOfferUnitPriceCents([], 2, 145_000), 145_000);
assert.equal(easyDealHasFreeShipping(offers, 3), true);
assert.equal(easyDealHasFreeShipping(offers, 2), false);

console.log(JSON.stringify({ ok: true, easyDealOriginRestricted: true }, null, 2));
