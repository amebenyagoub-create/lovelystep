import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.META_TRACKING_ENABLED = "false";

const pixelCalls = [];
const serverCalls = [];
globalThis.document = { cookie: "lovelystep_consent=granted" };
globalThis.window = { fbq: (...args) => pixelCalls.push(args) };
globalThis.fetch = async (url, init) => {
  serverCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
  return new Response(null, { status: 204 });
};

const { trackMeta } = await import("../lib/meta-pixel.ts");
const customData = { content_ids: ["ensemble-3-pieces-petit-compagnon"], content_type: "product", value: 6600, currency: "DZD" };
for (const eventName of ["ViewContent", "AddToCart", "InitiateCheckout"]) trackMeta(eventName, customData);

assert.equal(pixelCalls.length, 3);
assert.equal(serverCalls.length, 3);
for (let index = 0; index < pixelCalls.length; index += 1) {
  assert.equal(serverCalls[index].url, "/api/meta/events");
  assert.equal(serverCalls[index].body.eventName, pixelCalls[index][1]);
  assert.equal(serverCalls[index].body.eventId, pixelCalls[index][3].eventID, "Pixel and CAPI must share one event id");
}

const routeSource = await readFile(new URL("../app/api/meta/events/route.ts", import.meta.url), "utf8");
assert.ok(routeSource.includes("sendServerEvent({"), "the API route must forward accepted events to Meta");
assert.ok(routeSource.includes("validSameOrigin(request)"), "the public endpoint must reject cross-site requests");
assert.ok(routeSource.includes('["ViewContent", "AddToCart", "InitiateCheckout"]'), "only the intended funnel events may use this endpoint");

console.log(JSON.stringify({ ok: true, events: serverCalls.map((call) => call.body.eventName) }));
