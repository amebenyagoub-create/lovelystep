import assert from "node:assert/strict";
import { easyDealCorsHeaders, parseEasyDealOrigins } from "../lib/easydeal.ts";

const testOrigin = "https://easy-deal-dz-test.benameurgoub.chatgpt.site";

assert.deepEqual([...parseEasyDealOrigins(undefined)], [testOrigin]);
assert.deepEqual([...parseEasyDealOrigins("https://shop.example, https://two.example/")], ["https://shop.example", "https://two.example"]);

const allowed = easyDealCorsHeaders(new Request("https://lovelystep.com/api/orders", { headers: { origin: testOrigin } }));
assert.equal(allowed?.get("Access-Control-Allow-Origin"), testOrigin);
assert.match(allowed?.get("Access-Control-Allow-Headers") ?? "", /X-Sales-Channel/);

const denied = easyDealCorsHeaders(new Request("https://lovelystep.com/api/orders", { headers: { origin: "https://evil.example" } }));
assert.equal(denied, null);

console.log(JSON.stringify({ ok: true, easyDealOriginRestricted: true }, null, 2));
