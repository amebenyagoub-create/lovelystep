import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pixelCalls = [];
const serverCalls = [];
globalThis.document = { cookie: "lovelystep_consent=granted" };
globalThis.window = {
  fbq: (...args) => pixelCalls.push({ platform: "meta", args }),
  ttq: { track: (...args) => pixelCalls.push({ platform: "tiktok", args }), page() {}, load() {} },
};
globalThis.fetch = async (url, init) => {
  serverCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
  return new Response(null, { status: 204 });
};

const { trackCommerce } = await import("../lib/commerce-tracking.ts");
trackCommerce("AddToCart", {
  content_ids: ["ensemble-happy-cute"],
  content_type: "product",
  contents: [{ id: "ensemble-happy-cute", quantity: 1, item_price: 6250 }],
  value: 6250,
  currency: "DZD",
  num_items: 1,
});

assert.equal(pixelCalls.length, 2, "one action must reach both browser pixels");
assert.equal(serverCalls.length, 2, "one action must reach both server APIs");
const metaEventId = pixelCalls.find((call) => call.platform === "meta").args[3].eventID;
const tiktokEventId = pixelCalls.find((call) => call.platform === "tiktok").args[2].event_id;
assert.equal(tiktokEventId, metaEventId, "all channels must share the event id used for deduplication");
assert.deepEqual(serverCalls.map((call) => call.url).sort(), ["/api/meta/events", "/api/tiktok/events"]);
assert.ok(serverCalls.every((call) => call.body.eventId === metaEventId));

const storeTracking = await readFile(new URL("../app/store-tracking.tsx", import.meta.url), "utf8");
assert.ok(storeTracking.includes("<TikTokPixel"), "the public store must mount the TikTok Pixel");
const orderRoute = await readFile(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
assert.ok(orderRoute.includes("sendTikTokPurchase"), "orders must send TikTok Purchase through Events API");

console.log(JSON.stringify({ ok: true, eventId: metaEventId, serverCalls: serverCalls.map((call) => call.url) }));

